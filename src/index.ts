import { Events, Interaction } from 'discord.js';
import { config } from './config/config.js';
import { logger } from './utils/logger.js';
import discordClient, { destroyDiscordClient } from './utils/discordClient.js';
import { destroyDatabase, loadAuthorizedGuildIds } from './db/database.js';
import { initializeLogQueue, shutdownLogQueue } from './queue/logEventQueue.js';

import { loadAlertSubscriptions } from './utils/alertManager.js';
import { checkAndLeaveUnauthorizedGuilds } from './utils/guildAuthorization.js';

// 로더 임포트
import { loadLegacyCommands } from './utils/loadLegacyCommands.js';
import { loadSlashCommands } from './utils/loadSlashCommands.js';
import { loadEvents } from './utils/loadEvents.js';

logger.info('Starting logger bot...');

// --- 초기화 함수 ---
async function initializeBot() {
    try {
        // 1. 레거시 명령어 로드 (discordClient.legacyCommands에 저장)
        await loadLegacyCommands(discordClient);

        // 2. 슬래시 명령어 로드 및 등록 (discordClient.commands에 저장 및 API 등록 시도)
        await loadSlashCommands(discordClient);

        // 3. 이벤트 핸들러 로드 및 등록 (loadEvents 내부에서 discordClient.on/once 호출)
        await loadEvents(discordClient);

        // 4. 허가된 길드 목록 로드
        await loadAuthorizedGuildIds();

        // 5. 알림 구독 정보 로드
        await loadAlertSubscriptions();

        // 6. 로그 큐 초기화 (설정 비활성화 시 direct DB write로 동작)
        await initializeLogQueue();

        // 7. InteractionCreate 리스너 직접 등록 (슬래시 커맨드 실행 로직)
        discordClient.on(Events.InteractionCreate, (interaction) => {
            void handleInteraction(interaction);
        });
        logger.info('InteractionCreate listener registered.');

        // 8. ClientReady 이벤트 등록 (간단 로그)
        discordClient.once(Events.ClientReady, (readyClient) => {
            void (async () => {
                // 슬래시 커맨드 등록 로그는 loadSlashCommands 에서 출력됨
                await checkAndLeaveUnauthorizedGuilds(readyClient);
            })();
        });

        // 6. 봇 로그인
        logger.info('Logging in to Discord...');
        await discordClient.login(config.discordBotToken);
    } catch (error) {
        logger.error('Critical error during bot initialization:', error);
        process.exit(1);
    }
}

async function handleInteraction(interaction: Interaction) {
    if (!interaction.isChatInputCommand()) return;
    // 타입 단언 사용 (loadSlashCommands에서 초기화 보장)
    const command = discordClient.commands!.get(interaction.commandName);
    if (!command) {
        logger.warn(`Unknown slash command received: ${interaction.commandName}`);
        try {
            await interaction.reply({ content: '알 수 없는 명령어입니다.', ephemeral: true });
        } catch {
            /* empty */
        }
        return;
    }
    try {
        await command.execute(interaction, discordClient); // client 전달
    } catch (error) {
        logger.error(`Error executing slash command ${interaction.commandName}:`, error);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: '명령어 실행 중 오류가 발생했습니다.',
                    ephemeral: true,
                });
            } else {
                await interaction.reply({
                    content: '명령어 실행 중 오류가 발생했습니다.',
                    ephemeral: true,
                });
            }
        } catch {
            /* empty */
        } // 오류 응답 실패는 무시
    }
}

void initializeBot();

function setupGracefulShutdown() {
    const shutdown = async (signal: NodeJS.Signals) => {
        logger.info(`Received ${signal}. Shutting down gracefully...`);
        try {
            await shutdownLogQueue();
            destroyDiscordClient();
            await destroyDatabase();
            destroyDiscordClient();
            await destroyDatabase();
            // webdav client is now managed by StorageManager which doesn't need explicit destroy yet
            // or we add storageManager.destroy() if needed, but for now removing the legacy call
            logger.info('Shutdown complete.');
        } catch (err) {
            logger.error('Error during shutdown:', err);
        } finally {
            process.exit(0);
        }
    };
    process.once('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}

setupGracefulShutdown();

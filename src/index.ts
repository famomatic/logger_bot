import { Events } from 'discord.js';

import {
    ensureSlashCommandPermission,
    logPermissionCheckFailure,
} from './commandShared/slashPermission.js';
import { config } from './config/config.js';
import { destroyDatabase, loadAuthorizedGuildIds } from './db/database.js';
import { getInteractionLocale, t } from './i18n/index.js';
import { initializeLogQueue, shutdownLogQueue } from './queue/logEventQueue.js';
import { recoverMissedMessagesOnStartup } from './services/startupMessageRecoveryService.js';
import { loadAlertSubscriptions } from './utils/alertManager.js';
import { destroyDiscordClient, discordClient } from './utils/discordClient.js';
import { checkAndLeaveUnauthorizedGuilds } from './utils/guildAuthorization.js';
import { loadEvents } from './utils/loadEvents.js';
import { loadLegacyCommands } from './utils/loadLegacyCommands.js';
import { loadSlashCommands } from './utils/loadSlashCommands.js';
import { logger } from './utils/logger.js';
import { registerShutdownHandler, requestShutdown } from './utils/shutdownManager.js';

import type { Interaction } from 'discord.js';

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
            handleInteraction(interaction).catch((interactionError) => {
                logger.error('Unhandled interaction handler error:', interactionError);
            });
        });
        logger.info('InteractionCreate listener registered.');

        // 8. ClientReady 이벤트 등록 (간단 로그)
        discordClient.once(Events.ClientReady, (readyClient) => {
            (async () => {
                // 슬래시 커맨드 등록 로그는 loadSlashCommands 에서 출력됨
                await checkAndLeaveUnauthorizedGuilds(readyClient);
                await recoverMissedMessagesOnStartup(readyClient);
            })().catch((readyError) => {
                logger.error('ClientReady startup task failed:', readyError);
            });
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
        const locale = getInteractionLocale(interaction);
        try {
            await interaction.reply({
                content: t(locale, 'common.unknownCommand'),
                ephemeral: true,
            });
        } catch {
            /* empty */
        }
        return;
    }
    try {
        try {
            const allowed = await ensureSlashCommandPermission(interaction);
            if (!allowed) {
                return;
            }
        } catch (permissionError) {
            logPermissionCheckFailure(interaction, permissionError);
            const locale = getInteractionLocale(interaction);
            await interaction.reply({
                content: t(locale, 'common.commandError'),
                ephemeral: true,
            });
            return;
        }

        await command.execute(interaction, discordClient); // client 전달
    } catch (error) {
        logger.error(`Error executing slash command ${interaction.commandName}:`, error);
        const locale = getInteractionLocale(interaction);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: t(locale, 'common.commandError'),
                    ephemeral: true,
                });
            } else {
                await interaction.reply({
                    content: t(locale, 'common.commandError'),
                    ephemeral: true,
                });
            }
        } catch {
            /* empty */
        } // 오류 응답 실패는 무시
    }
}

initializeBot().catch((initializeError) => {
    logger.error('Failed to initialize bot:', initializeError);
});

function setupGracefulShutdown() {
    registerShutdownHandler(async ({ reason, error }) => {
        logger.info(`Shutdown requested (${reason}).`);
        if (error) {
            logger.error('Shutdown triggered by fatal error:', error);
        }
        try {
            await shutdownLogQueue();
            await destroyDiscordClient();
            await destroyDatabase();
            logger.info('Shutdown complete.');
        } catch (err) {
            logger.error('Error during shutdown:', err);
        }
    });

    process.once('SIGINT', () => {
        requestShutdown('SIGINT', { exitCode: 0 }).catch((shutdownError) => {
            logger.error('Failed to request SIGINT shutdown:', shutdownError);
        });
    });
    process.once('SIGTERM', () => {
        requestShutdown('SIGTERM', { exitCode: 0 }).catch((shutdownError) => {
            logger.error('Failed to request SIGTERM shutdown:', shutdownError);
        });
    });
}

setupGracefulShutdown();

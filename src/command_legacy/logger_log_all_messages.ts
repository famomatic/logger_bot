import { Message, PermissionsBitField } from 'discord.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import type { ClientWithLegacyCommands, LegacyCommand } from '../types/commands.js';
import {
    NoAccessibleGuildChannelsError,
    runGuildMessageBackfill,
} from '../services/logGuildMessagesService.js';

const command: LegacyCommand = {
    name: 'log-guild-messages',
    async execute(message: Message) {
        const args = message.content.trim().split(/ +/).slice(2);
        const targetGuildId = args[0];
        if (!targetGuildId) {
            await message.reply('사용법: logger log-guild-messages <guild_id>');
            return;
        }

        const memberPermissions = message.member?.permissions;
        const devLevel = config.getDevLevel(message.author.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 3 && !isAdmin) {
            await message.reply('이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.');
            return;
        }

        const reply = await message.reply(`길드 ${targetGuildId}의 모든 메시지를 기록합니다...`);
        const client = message.client as ClientWithLegacyCommands;
        logger.info(
            `Initiating bulk message logging for guild ${targetGuildId} by ${message.author.tag} (${message.author.id})`,
        );

        const legacyCommandPrefixes = client.legacyCommands
            ? Array.from(client.legacyCommands.keys())
            : [];

        try {
            const guild = await client.guilds.fetch(targetGuildId);
            const result = await runGuildMessageBackfill({
                guild,
                legacyCommandPrefixes,
            });

            let finalReply = `✅ **메시지 기록 확인 완료**\n\n`;
            finalReply += `> - **처리된 채널:** ${result.totalChannels}개\n`;
            finalReply += `> - **확인된 메시지 (봇 제외):** ${result.processedCount}개\n`;
            finalReply += `> - **새로 기록된 메시지:** ${result.newlyLoggedCount}개\n`;
            finalReply += `> - **활동 유저 수 (추정):** ${result.uniqueUserCount}명\n`;
            if (result.errorCount > 0) {
                finalReply += `> - **오류 발생:** ⚠️ ${result.errorCount}개\n`;
            }
            finalReply += `> - **총 소요 시간:** ${result.durationSeconds.toFixed(2)}초`;
            await reply.edit(finalReply);

            logger.info(
                `Finished bulk message logging check for guild ${targetGuildId}. Processed ${result.totalChannels} channels, checked ${result.processedCount} messages, newly logged ${result.newlyLoggedCount} with ${result.errorCount} errors in ${result.durationSeconds}s.`,
            );
        } catch (error) {
            if (error instanceof NoAccessibleGuildChannelsError) {
                await reply.edit(
                    '오류: 이 서버에서 메시지 기록을 읽을 수 있는 채널을 찾을 수 없습니다. (봇 권한 확인 필요)',
                );
                return;
            }

            logger.error(
                `Critical error during bulk message logging check for guild ${targetGuildId}:`,
                error,
            );
            const err = error as Error;
            await reply.edit(`오류 발생: ${String(err.message || err).substring(0, 1800)}`);
        }
    },
};

export { command };

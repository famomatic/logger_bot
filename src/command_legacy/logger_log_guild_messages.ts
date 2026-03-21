import { config } from '../config/config.js';
import { getMessageLocale, t } from '../i18n/index.js';
import {
    NoAccessibleGuildChannelsError,
    runGuildMessageBackfill,
} from '../services/logGuildMessagesService.js';
import { logger } from '../utils/logger.js';

import type { ClientWithLegacyCommands, LegacyCommand } from '../types/commands.js';
import type { Message } from 'discord.js';

const command: LegacyCommand = {
    name: 'log-guild-messages',
    async execute(message: Message) {
        const locale = getMessageLocale(message);
        const args = message.content.trim().split(/ +/).slice(2);
        const targetGuildId = args[0];
        if (!targetGuildId) {
            await message.reply(t(locale, 'backfill.usageGuild'));
            return;
        }

        if (!config.superAdminIds.includes(message.author.id)) {
            await message.reply(t(locale, 'common.devOnly'));
            return;
        }

        const reply = await message.reply(
            t(locale, 'backfill.startGuildLegacy', { guildId: targetGuildId }),
        );
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

            let finalReply = `${t(locale, 'backfill.completeTitle')}\n\n`;
            finalReply += `${t(locale, 'backfill.processedChannels', { count: result.totalChannels })}\n`;
            finalReply += `${t(locale, 'backfill.checkedMessages', { count: result.processedCount })}\n`;
            finalReply += `${t(locale, 'backfill.newlyLogged', { count: result.newlyLoggedCount })}\n`;
            finalReply += `${t(locale, 'backfill.activeUsers', { count: result.uniqueUserCount })}\n`;
            if (result.errorCount > 0) {
                finalReply += `${t(locale, 'backfill.errorCount', { count: result.errorCount })}\n`;
            }
            finalReply += t(locale, 'backfill.duration', {
                seconds: result.durationSeconds.toFixed(2),
            });
            await reply.edit(finalReply);

            logger.info(
                `Finished bulk message logging check for guild ${targetGuildId}. Processed ${result.totalChannels} channels, checked ${result.processedCount} messages, newly logged ${result.newlyLoggedCount} with ${result.errorCount} errors in ${result.durationSeconds}s.`,
            );
        } catch (error) {
            if (error instanceof NoAccessibleGuildChannelsError) {
                await reply.edit(t(locale, 'backfill.noReadableChannels'));
                return;
            }

            logger.error(
                `Critical error during bulk message logging check for guild ${targetGuildId}:`,
                error,
            );
            const err = error as Error;
            await reply.edit(
                t(locale, 'messageCmd.genericError', {
                    error: String(err.message || err).substring(0, 1800),
                }),
            );
        }
    },
};

/**
 * 레거시 커맨드 모듈 계약(`export { command }`)입니다.
 */
export { command };

import { SlashCommandBuilder, MessageFlags, InteractionContextType } from 'discord.js';

import { ensureSlashCommandPermission, isSuperAdmin } from '../commandShared/slashPermission.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import {
    NoAccessibleGuildChannelsError,
    runGuildMessageBackfill,
} from '../services/logGuildMessagesService.js';
import { logger } from '../utils/logger.js';

import type { SlashCommand } from '../types/commands.js';
import type { CommandInteraction, Client } from 'discord.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('log-guild-messages')
        .setDescription(defaultText('backfill.logGuildDesc'))
        .addStringOption((option) =>
            option
                .setName('guild_id')
                .setDescription(defaultText('messageCmd.guildId'))
                .setRequired(true),
        )
        .setContexts(InteractionContextType.Guild),

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        const locale = getInteractionLocale(interaction);
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuildStrict'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (!(await ensureSlashCommandPermission(interaction))) {
            return;
        }

        const targetGuildId = interaction.options.getString('guild_id', true);
        if (targetGuildId !== interaction.guildId && !isSuperAdmin(interaction.user.id)) {
            await interaction.reply({
                content: t(locale, 'common.commandNotAllowed'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        logger.info(
            `Initiating bulk message logging for guild ${targetGuildId} by ${interaction.user.tag} (${interaction.user.id})`,
        );
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const legacyCommandNames = client.legacyCommands
            ? Array.from(client.legacyCommands.keys())
            : [];

        try {
            const guild = await client.guilds.fetch(targetGuildId);
            const result = await runGuildMessageBackfill({
                guild,
                legacyCommandNames,
            });

            let finalReply = `${t(locale, 'backfill.completeTitle')}\n\n`;
            finalReply += `${t(locale, 'backfill.processedChannels', { count: result.totalChannels })}\n`;
            finalReply += `${t(locale, 'backfill.checkedMessages', { count: result.processedCount })}\n`;
            finalReply += `${t(locale, 'backfill.newlyLogged', { count: result.newlyLoggedCount })}\n`;
            finalReply += `${t(locale, 'backfill.activeUsers', { count: result.uniqueUserCount })}\n`;
            if (result.errorCount > 0) {
                finalReply += `${t(locale, 'backfill.errorCount', { count: result.errorCount })}\n`;
            }
            finalReply += `${t(locale, 'backfill.duration', { seconds: result.durationSeconds.toFixed(2) })}\n\n`;
            finalReply += t(locale, 'backfill.detailsInLog');

            if (result.durationSeconds > 900) {
                await interaction.channel?.send(`${interaction.user.toString()} ${finalReply}`);
                await interaction.editReply({
                    content: t(locale, 'backfill.timeoutChannelNotice'),
                });
                return;
            }

            await interaction.editReply(finalReply);
            logger.info(
                `Finished bulk message logging check for guild ${targetGuildId}. Processed ${result.totalChannels} channels, checked ${result.processedCount} messages, newly logged ${result.newlyLoggedCount} from approx ${result.uniqueUserCount} users with ${result.errorCount} errors in ${result.durationSeconds}s.`,
            );
        } catch (error) {
            if (error instanceof NoAccessibleGuildChannelsError) {
                await interaction.editReply(t(locale, 'backfill.noReadableChannels'));
                return;
            }

            logger.error(
                `Critical error during bulk message logging check for guild ${targetGuildId}:`,
                error,
            );
            const err = error as Error;
            const errorMessage = t(locale, 'backfill.criticalError', {
                error: String(err.message || err).substring(0, 1800),
            });

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(errorMessage);
            } else {
                await interaction.reply({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    },
};

import {
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';

import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { config } from '../config/config.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import { getLogQueueStats, redriveLogQueueDlq } from '../queue/logEventQueue.js';
import { logger } from '../utils/logger.js';

import type { ChatInputCommandInteraction } from 'discord.js';

const DEFAULT_REDRIVE_LIMIT = 100;
const MAX_REDRIVE_LIMIT = 5_000;

export const command = {
    data: new SlashCommandBuilder()
        .setName('log-dlq-redrive')
        .setDescription(defaultText('command.logDlqRedriveDescription'))
        .addIntegerOption((option) =>
            option
                .setName('count')
                .setDescription(defaultText('command.logDlqRedriveCountDescription'))
                .setMinValue(1)
                .setMaxValue(MAX_REDRIVE_LIMIT)
                .setRequired(false),
        )
        .setIntegrationTypes(
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
        )
        .setContexts(InteractionContextType.Guild),
    permission: {
        public: false,
        listable: false,
    },
    async execute(interaction: ChatInputCommandInteraction) {
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
        if (!config.superAdminIds.includes(interaction.user.id)) {
            await interaction.reply({
                content: t(locale, 'common.devOnly'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const limit = interaction.options.getInteger('count') ?? DEFAULT_REDRIVE_LIMIT;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const moved = await redriveLogQueueDlq(limit);
        const stats = await getLogQueueStats();
        logger.warn(
            `/log-dlq-redrive by ${interaction.user.tag} moved=${moved} pending=${stats?.pending ?? 'N/A'} processing=${stats?.processing ?? 'N/A'} dlq=${stats?.dlq ?? 'N/A'}`,
        );

        await interaction.editReply(
            [
                `Redriven: ${moved}`,
                `Pending: ${stats?.pending ?? 'N/A'}`,
                `Processing: ${stats?.processing ?? 'N/A'}`,
                `DLQ: ${stats?.dlq ?? 'N/A'}`,
            ].join('\n'),
        );
    },
};

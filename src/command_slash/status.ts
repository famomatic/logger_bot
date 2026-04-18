import { ApplicationIntegrationType, SlashCommandBuilder } from 'discord.js';

import { buildStatusReply, collectStatusSnapshot } from '../commandShared/statusCore.js';
import { getInteractionLocale, localizations, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { ChatInputCommandInteraction } from 'discord.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription(localizations('command.statusDescription').ko)
        .setDescriptionLocalizations(localizations('command.statusDescription'))
        .setIntegrationTypes(
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
        ),
    permission: {
        public: true,
        listable: false,
    },
    async execute(interaction: ChatInputCommandInteraction) {
        const locale = getInteractionLocale(interaction);
        logger.info(`/status command executed by ${interaction.user.tag}`);
        try {
            await interaction.deferReply();

            const client = interaction.client;
            const snapshot = await collectStatusSnapshot(client, 'slash', locale);
            const replyOptions = buildStatusReply(client, snapshot, locale, 0x3498db);

            await interaction.editReply(replyOptions);
        } catch (error) {
            const err = error as Error;
            logger.error('Error executing slash status command:', err);
            logger.error(
                'Full error object for slash status:',
                JSON.stringify(err, Object.getOwnPropertyNames(err)),
            );
            const errContent = t(locale, 'status.fetchError', { error: err.message });
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: errContent,
                    components: [],
                });
            } else {
                await interaction.reply({ content: errContent, ephemeral: true });
            }
        }
    },
};

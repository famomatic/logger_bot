import {
    SlashCommandBuilder,
    CommandInteraction,
    Client,
    PermissionsBitField,
    MessageFlags,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import type { SlashCommand } from '../types/commands.js';
import { canRunReload, executeReload } from '../commandShared/reloadCore.js';
import { getInteractionLocale, localizations, t } from '../i18n/index.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription(localizations('command.reloadDescription').ko)
        .setDescriptionLocalizations(localizations('command.reloadDescription'))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator), // 관리자만 사용 가능하도록 설정

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        const locale = getInteractionLocale(interaction);
        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (!canRunReload(interaction.user.id, Boolean(isAdmin))) {
            await interaction.reply({
                content: t(locale, 'common.adminOrDevOnly'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        logger.info(`/reload command executed by ${interaction.user.tag}`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            await executeReload(client);
            await interaction.editReply(t(locale, 'reload.success'));
        } catch (error) {
            logger.error('Reload failed:', error);
            await interaction.editReply(t(locale, 'reload.failed'));
        }
    },
};

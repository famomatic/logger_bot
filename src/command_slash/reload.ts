import { SlashCommandBuilder, MessageFlags } from 'discord.js';

import { executeReload } from '../commandShared/reloadCore.js';
import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { getInteractionLocale, localizations, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { SlashCommand } from '../types/commands.js';
import type { CommandInteraction, Client } from 'discord.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription(localizations('command.reloadDescription').ko)
        .setDescriptionLocalizations(localizations('command.reloadDescription')), // 관리자만 사용 가능하도록 설정

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        if (!(await ensureSlashCommandPermission(interaction))) {
            return;
        }
        const locale = getInteractionLocale(interaction);

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

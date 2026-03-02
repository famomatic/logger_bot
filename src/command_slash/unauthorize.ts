import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    PermissionsBitField,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';
import { config } from '../config/config.js';
import { unauthorizeGuildId } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { getInteractionLocale, localizations, t } from '../i18n/index.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('unauthorize')
        .setDescription(localizations('command.unauthorizeDescription').ko)
        .setDescriptionLocalizations(localizations('command.unauthorizeDescription'))
        .addStringOption((o) =>
            o
                .setName('guild_id')
                .setDescription(localizations('command.unauthorizeGuildId').ko)
                .setDescriptionLocalizations(localizations('command.unauthorizeGuildId'))
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .setContexts(InteractionContextType.Guild),
    async execute(interaction: ChatInputCommandInteraction) {
        const locale = getInteractionLocale(interaction);
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuild'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 3 && !isAdmin) {
            await interaction.reply({
                content: t(locale, 'common.level3OrAdminOnly'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const gid = interaction.options.getString('guild_id', true);
        await unauthorizeGuildId(gid);
        logger.info(`/unauthorize executed by ${interaction.user.tag} for guild ${gid}`);
        await interaction.reply({
            content: t(locale, 'command.unauthorizeSuccess', { guildId: gid }),
            flags: MessageFlags.Ephemeral,
        });
    },
};

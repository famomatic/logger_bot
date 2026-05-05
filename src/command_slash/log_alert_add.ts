import { SlashCommandBuilder, ChannelType, MessageFlags, InteractionContextType } from 'discord.js';

import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import { addSubscription, categoryEventMap } from '../utils/alertManager.js';
import { logger } from '../utils/logger.js';

import type { ChatInputCommandInteraction } from 'discord.js';

const choices = Object.keys(categoryEventMap)
    .map((cat) => ({ name: cat, value: cat }))
    .slice(0, 25);

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('log-alert-add')
        .setDescription(defaultText('logAlert.addDescription'))
        .addStringOption((o) =>
            o
                .setName('event_type')
                .setDescription(defaultText('logAlert.eventCategory'))
                .setRequired(true)
                .addChoices(...choices),
        )
        .addChannelOption((o) =>
            o
                .setName('channel')
                .setDescription(defaultText('logAlert.targetChannel'))
                .setRequired(true)
                .addChannelTypes(
                    ChannelType.GuildText,
                    ChannelType.GuildAnnouncement,
                    ChannelType.PublicThread,
                    ChannelType.PrivateThread,
                ),
        )
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
        if (!(await ensureSlashCommandPermission(interaction))) {
            return;
        }
        const category = interaction.options.getString('event_type', true);
        const optionChannel = interaction.options.getChannel('channel', true);
        // Only text-based guild channels are allowed through addChannelTypes above,
        // but the returned type does not expose text methods. Narrow the type here.
        if (!('isTextBased' in optionChannel) || !optionChannel.isTextBased()) {
            await interaction.reply({
                content: t(locale, 'logAlert.textChannelOnly'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const channel = optionChannel;
        const added = addSubscription(interaction.guildId, category, channel.id);
        if (!added) {
            await interaction.reply({
                content: t(locale, 'logAlert.invalidCategory'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        logger.info(
            `/log-alert-add set by ${interaction.user.tag} in guild ${interaction.guildId} for category ${category} channel ${channel.id}`,
        );
        await interaction.reply({
            content: t(locale, 'logAlert.addSuccess', {
                category,
                channel: channel.toString(),
            }),
            flags: MessageFlags.Ephemeral,
        });
    },
};

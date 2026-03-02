import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionsBitField,
    ChannelType,
    GuildTextBasedChannel,
    InteractionContextType,
} from 'discord.js';
import { config } from '../config/config.js';
import { categoryEventMap } from '../utils/alertManager.js';
import { logger } from '../utils/logger.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';

const choices = Object.keys(categoryEventMap)
    .map((cat) => ({ name: cat, value: cat }))
    .slice(0, 25);

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('log-alert-test')
        .setDescription(defaultText('logAlert.testDescription'))
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
                .setDescription(defaultText('logAlert.testChannel'))
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

        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 2 && !isAdmin) {
            await interaction.reply({
                content: t(locale, 'common.level2OrAdminOnly'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const category = interaction.options.getString('event_type', true);
        const eventTypes = categoryEventMap[category];
        if (!eventTypes) {
            await interaction.reply({
                content: t(locale, 'logAlert.invalidCategory'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const optionChannel = interaction.options.getChannel('channel', true);
        if (!('isTextBased' in optionChannel) || !optionChannel.isTextBased()) {
            await interaction.reply({
                content: t(locale, 'logAlert.textChannelOnly'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const channel = optionChannel as GuildTextBasedChannel;

        try {
            await channel.send({
                content: [
                    t(locale, 'logAlert.testHeader'),
                    t(locale, 'logAlert.testCategory', { category }),
                    t(locale, 'logAlert.testEvents', { events: eventTypes.join(', ') }),
                    t(locale, 'logAlert.testExecutor', { userId: interaction.user.id }),
                    t(locale, 'logAlert.testTime', { timestamp: Math.floor(Date.now() / 1000) }),
                ].join('\n'),
                allowedMentions: { parse: [] },
            });

            logger.info(
                `/log-alert-test by ${interaction.user.tag} in guild ${interaction.guildId} for category ${category} channel ${channel.id}`,
            );

            await interaction.reply({
                content: t(locale, 'logAlert.testSent', { channel: channel.toString() }),
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error('/log-alert-test failed to send message:', error);
            await interaction.reply({
                content: t(locale, 'logAlert.testFailed'),
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};

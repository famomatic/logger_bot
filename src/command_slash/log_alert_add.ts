import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    PermissionsBitField,
    ChannelType,
    MessageFlags,
    GuildTextBasedChannel,
    InteractionContextType,
} from 'discord.js';
import { config } from '../config/config.js';
import { addSubscription, categoryEventMap } from '../utils/alertManager.js';
import { logger } from '../utils/logger.js';

const choices = Object.keys(categoryEventMap)
    .map((cat) => ({ name: cat, value: cat }))
    .slice(0, 25);

export const command = {
    data: new SlashCommandBuilder()
        .setName('log-alert-add')
        .setDescription('특정 이벤트 카테고리의 알림을 채널로 전송합니다.')
        .addStringOption((o) =>
            o
                .setName('event_type')
                .setDescription('이벤트 카테고리')
                .setRequired(true)
                .addChoices(...choices),
        )
        .addChannelOption((o) =>
            o
                .setName('channel')
                .setDescription('알림을 보낼 채널')
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
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버에서만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 2 && !isAdmin) {
            await interaction.reply({
                content: '이 명령어는 레벨2 이상 개발자 또는 관리자만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const category = interaction.options.getString('event_type', true);
        const optionChannel = interaction.options.getChannel('channel', true);
        // Only text-based guild channels are allowed through addChannelTypes above,
        // but the returned type does not expose text methods. Narrow the type here.
        if (!('isTextBased' in optionChannel) || !optionChannel.isTextBased()) {
            await interaction.reply({
                content: '텍스트 채널만 지정할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const channel = optionChannel as GuildTextBasedChannel;
        const added = addSubscription(interaction.guildId, category, channel.id);
        if (!added) {
            await interaction.reply({
                content: '유효하지 않은 이벤트 카테고리입니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        logger.info(
            `/log-alert-add set by ${interaction.user.tag} in guild ${interaction.guildId} for category ${category} channel ${channel.id}`,
        );
        await interaction.reply({
            content: `이제 ${category} 이벤트 알림이 ${channel.toString()} 채널에 전송됩니다.`,
            flags: MessageFlags.Ephemeral,
        });
    },
};

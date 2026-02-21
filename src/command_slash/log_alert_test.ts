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

const choices = Object.keys(categoryEventMap)
    .map((cat) => ({ name: cat, value: cat }))
    .slice(0, 25);

export const command = {
    data: new SlashCommandBuilder()
        .setName('log-alert-test')
        .setDescription('로그 알림 채널로 테스트 메시지를 보냅니다.')
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
                .setDescription('테스트 메시지를 보낼 채널')
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
        const eventTypes = categoryEventMap[category];
        if (!eventTypes) {
            await interaction.reply({
                content: '유효하지 않은 이벤트 카테고리입니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const optionChannel = interaction.options.getChannel('channel', true);
        if (!('isTextBased' in optionChannel) || !optionChannel.isTextBased()) {
            await interaction.reply({
                content: '텍스트 채널만 지정할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const channel = optionChannel as GuildTextBasedChannel;

        try {
            await channel.send({
                content: [
                    '로그 알림 테스트',
                    `카테고리: ${category}`,
                    `대상 이벤트: ${eventTypes.join(', ')}`,
                    `실행자: <@${interaction.user.id}>`,
                    `시각: <t:${Math.floor(Date.now() / 1000)}:F>`,
                ].join('\n'),
                allowedMentions: { parse: [] },
            });

            logger.info(
                `/log-alert-test by ${interaction.user.tag} in guild ${interaction.guildId} for category ${category} channel ${channel.id}`,
            );

            await interaction.reply({
                content: `테스트 메시지를 ${channel.toString()} 채널로 전송했습니다.`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error('/log-alert-test failed to send message:', error);
            await interaction.reply({
                content: '테스트 메시지를 보낼 수 없습니다. 봇 권한을 확인해주세요.',
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};

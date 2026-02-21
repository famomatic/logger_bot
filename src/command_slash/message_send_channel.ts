import {
    SlashCommandBuilder,
    CommandInteraction,
    PermissionsBitField,
    Client,
    GuildTextBasedChannel,
    Channel,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import type { SlashCommand } from '../types/commands.js';

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-send-channel')
        .setDescription('지정한 채널 ID에 메시지를 전송합니다.')
        .addStringOption((option) =>
            option.setName('channelid').setDescription('메시지를 보낼 채널의 ID').setRequired(true),
        )
        .addStringOption((option) =>
            option.setName('content').setDescription('전송할 메시지 내용').setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .setContexts(InteractionContextType.Guild),

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버 내에서만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // 개발자 또는 관리자 권한 확인
        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 3 && !isAdmin) {
            await interaction.reply({
                content: '이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        logger.info(`/message-send-channel command executed by ${interaction.user.tag}`);

        // 옵션에서 채널 ID 문자열 가져오기
        const targetChannelId = interaction.options.getString('channelid', true);
        const messageContent = interaction.options.getString('content', true);
        const logPrefix = '[message-send-channel]';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // 채널 ID 유효성 검사
        if (!/^\d{17,19}$/.test(targetChannelId)) {
            await interaction.editReply({
                content: `오류: 제공된 채널 ID (${targetChannelId})가 올바른 형식이 아닙니다.`,
            });
            return;
        }

        let targetChannel: Channel | null = null;
        try {
            // 채널 ID로 채널 객체 가져오기
            targetChannel = await client.channels.fetch(targetChannelId);
        } catch (error) {
            logger.warn(`${logPrefix} Failed to fetch channel ${targetChannelId}:`, error);
            await interaction.editReply({
                content: `오류: 채널 ID ${targetChannelId}를 찾을 수 없거나 봇이 접근할 수 없습니다.`,
            });
            return;
        }

        if (!targetChannel) {
            await interaction.editReply({
                content: `오류: 채널 ID ${targetChannelId}를 찾을 수 없습니다.`,
            });
            return;
        }

        // 가져온 채널 타입 확인 (메시지 전송 가능 여부)
        if (!targetChannel.isTextBased() || targetChannel.isDMBased()) {
            await interaction.editReply({
                content: `오류: 채널 ID ${targetChannelId}는 텍스트 메시지를 보낼 수 없는 채널 타입입니다.`,
            });
            return;
        }

        // 봇 권한 확인 (채널 객체 직접 사용)
        // GuildTextBasedChannel 타입으로 단언 (isTextBased, !isDMBased 통과했으므로)
        const textChannel = targetChannel as GuildTextBasedChannel;
        let botPermissions;
        try {
            // 채널이 속한 길드 정보가 필요
            if (!textChannel.guild) {
                await interaction.editReply({
                    content: '오류: 채널이 속한 서버 정보를 가져올 수 없습니다.',
                });
                return;
            }
            const botMember = await textChannel.guild.members.fetch(client.user!.id);
            botPermissions = textChannel.permissionsFor(botMember);
        } catch (permError) {
            logger.error(
                `${logPrefix} Failed to fetch bot permissions for channel ${targetChannelId}:`,
                permError,
            );
            await interaction.editReply({
                content: '오류: 채널 권한을 확인하는 중 오류가 발생했습니다.',
            });
            return;
        }

        if (!botPermissions?.has(PermissionsBitField.Flags.SendMessages)) {
            await interaction.editReply({
                content: `오류: 채널 '${textChannel.name}'(${targetChannelId})에 메시지를 보낼 권한이 없습니다.`,
            });
            return;
        }
        if (
            textChannel.isThread() &&
            !botPermissions?.has(PermissionsBitField.Flags.SendMessagesInThreads)
        ) {
            await interaction.editReply({
                content: `오류: 스레드 '${textChannel.name}'(${targetChannelId})에 메시지를 보낼 권한이 없습니다.`,
            });
            return;
        }

        try {
            // 메시지 전송 (타입 단언된 채널 사용)
            await textChannel.send(messageContent);
            logger.info(
                `${logPrefix} Successfully sent message to channel #${textChannel.name} (${targetChannelId}) in guild ${textChannel.guildId} by ${interaction.user.tag}. Content length: ${messageContent.length}`,
            );
            await interaction.editReply({
                content: `✅ 채널 <#${targetChannelId}>에 메시지를 성공적으로 전송했습니다.`,
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`${logPrefix} Failed to send message to channel ${targetChannelId}:`, err);
            await interaction.editReply({
                content: `❌ 오류: 채널 <#${targetChannelId}>에 메시지를 보내는 중 오류가 발생했습니다: ${err.message}`,
            });
        }
    },
};

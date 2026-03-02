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
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-send-channel')
        .setDescription(defaultText('messageCmd.sendChannelDesc'))
        .addStringOption((option) =>
            option
                .setName('channelid')
                .setDescription(defaultText('messageCmd.channelId'))
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('content')
                .setDescription(defaultText('messageCmd.content'))
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .setContexts(InteractionContextType.Guild),

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        const locale = getInteractionLocale(interaction);
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuildStrict'),
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
                content: t(locale, 'common.adminOrDevOnly'),
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
                content: t(locale, 'messageCmd.invalidProvidedChannelId', {
                    channelId: targetChannelId,
                }),
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
                content: t(locale, 'messageCmd.channelNotFoundOrNoAccess', {
                    channelId: targetChannelId,
                }),
            });
            return;
        }

        if (!targetChannel) {
            await interaction.editReply({
                content: t(locale, 'messageCmd.channelNotFound', { channelId: targetChannelId }),
            });
            return;
        }

        // 가져온 채널 타입 확인 (메시지 전송 가능 여부)
        if (!targetChannel.isTextBased() || targetChannel.isDMBased()) {
            await interaction.editReply({
                content: t(locale, 'messageCmd.channelInvalidType', { channelId: targetChannelId }),
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
                    content: t(locale, 'messageCmd.cannotGetGuildFromChannel'),
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
                content: t(locale, 'messageCmd.permissionCheckFailed'),
            });
            return;
        }

        if (!botPermissions?.has(PermissionsBitField.Flags.SendMessages)) {
            await interaction.editReply({
                content: t(locale, 'messageCmd.noSendPermission', {
                    channel: textChannel.name,
                    channelId: targetChannelId,
                }),
            });
            return;
        }
        if (
            textChannel.isThread() &&
            !botPermissions?.has(PermissionsBitField.Flags.SendMessagesInThreads)
        ) {
            await interaction.editReply({
                content: t(locale, 'messageCmd.noThreadSendPermission', {
                    channel: textChannel.name,
                    channelId: targetChannelId,
                }),
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
                content: t(locale, 'messageCmd.sentToChannel', { channelId: targetChannelId }),
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`${logPrefix} Failed to send message to channel ${targetChannelId}:`, err);
            await interaction.editReply({
                content: t(locale, 'messageCmd.sendToChannelFailed', {
                    channelId: targetChannelId,
                    error: err.message,
                }),
            });
        }
    },
};

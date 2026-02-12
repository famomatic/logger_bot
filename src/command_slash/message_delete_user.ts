import {
    SlashCommandBuilder,
    CommandInteraction,
    PermissionsBitField,
    GuildTextBasedChannel,
    Collection,
    Message,
    Client,
    SlashCommandOptionsOnlyBuilder,
    MessageFlags,
} from 'discord.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

// --- 타입 정의 (최종 수정) ---
interface SlashCommand {
    data: SlashCommandOptionsOnlyBuilder; // <--- 여기를 다시 SlashCommandOptionsOnlyBuilder 로 수정
    execute: (interaction: CommandInteraction, client: Client) => Promise<void>;
}
// --- ------------ ---

// 슬래시 커맨드 정의 및 실행 로직
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-delete-user') // <<< 이름 변경됨
        .setDescription(
            '{user_id}의 메시지를 삭제합니다. guild_id 또는 channel_id 중 하나를 지정하세요.',
        )
        .addStringOption((option) =>
            option
                .setName('user_id')
                .setDescription('메시지를 삭제할 사용자의 ID')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('guild_id')
                .setDescription('메시지를 삭제할 서버의 ID')
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription('메시지를 삭제할 채널의 ID')
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .setDMPermission(false),

    async execute(interaction: CommandInteraction, client: Client) {
        // CommandInteraction 타입 가드 (ChatInputCommand으로 좁히기 위함)
        if (!interaction.isChatInputCommand()) return;
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버 내에서만 사용할 수 있습니다.',
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        // 개발자 ID 또는 관리자 권한 확인 (배열 사용)
        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>; // inGuild 보장되므로 member는 존재
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);

        if (devLevel < 3 && !isAdmin) {
            await interaction.reply({
                content: '이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.',
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        logger.info(`/message-delete-user command executed by ${interaction.user.tag}`);

        const targetGuildIdOption = interaction.options.getString('guild_id');
        const targetChannelIdOption = interaction.options.getString('channel_id');
        const targetUserId = interaction.options.getString('user_id', true);

        if (!targetGuildIdOption && !targetChannelIdOption) {
            await interaction.reply({
                content: '오류: guild_id 또는 channel_id 중 하나를 지정해야 합니다.',
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        let targetGuildId = targetGuildIdOption ?? undefined;
        let specificChannel: GuildTextBasedChannel | null = null;

        if (targetChannelIdOption) {
            try {
                const fetched = await client.channels.fetch(targetChannelIdOption);
                if (
                    !fetched ||
                    !fetched.isTextBased() ||
                    fetched.isDMBased() ||
                    !('guild' in fetched)
                ) {
                    await interaction.reply({
                        content: `오류: ID가 ${targetChannelIdOption}인 유효한 서버 채널을 찾을 수 없습니다.`,
                        flags: [MessageFlags.Ephemeral],
                    });
                    return;
                }
                specificChannel = fetched as GuildTextBasedChannel;
            } catch (err) {
                logger.error(
                    `[message-delete-user] Failed to fetch channel ${targetChannelIdOption}:`,
                    err,
                );
                await interaction.reply({
                    content: '채널 정보를 가져오는 중 오류가 발생했습니다.',
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }
            if (targetGuildId && specificChannel.guildId !== targetGuildId) {
                await interaction.reply({
                    content: '오류: 입력한 channel_id가 제공한 guild_id에 속해있지 않습니다.',
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }
            targetGuildId = specificChannel.guildId;
        }

        // 응답 지연 (ephemeral: true 로 설정하여 명령어 사용자에게만 보이게 함)
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        // 로그 접두사 변경
        const logPrefix = '[message-delete-user]';
        logger.info(
            `${logPrefix} Initiating message deletion for user ${targetUserId} in guild ${targetGuildId} by ${interaction.user.tag} (${interaction.user.id})`,
        );

        // 응답 보낼 채널 타입 확인 및 저장
        const channelToSendResponse = interaction.channel;
        if (!channelToSendResponse || !('send' in channelToSendResponse)) {
            logger.error(
                `${logPrefix} Cannot send response: Interaction channel is not text-based or lacks send permissions. Channel type: ${interaction.channel?.type}`,
            );
            try {
                await interaction
                    .editReply({ content: '오류: 응답을 보낼 수 없는 채널입니다.' })
                    .catch(() => {
                        /* empty */
                    });
            } catch {
                /* Ignore */
            }
            return;
        }

        let deletedCount = 0;
        const errorMessages: string[] = [];
        const startTime = Date.now();

        try {
            // 대상 길드 가져오기
            const guild = specificChannel
                ? specificChannel.guild
                : await client.guilds.fetch(targetGuildId!).catch(() => null);
            if (!guild) {
                logger.warn(
                    `${logPrefix} Attempted deletion in non-existent or inaccessible guild ${targetGuildId}`,
                );
                await interaction.editReply(
                    `오류: ID가 ${targetGuildId}인 서버를 찾을 수 없거나 봇이 해당 서버에 없습니다.`,
                );
                return;
            }

            // 대상 사용자 유효성 검사
            if (!/^\d{17,19}$/.test(targetUserId)) {
                await interaction.editReply(
                    `오류: 제공된 사용자 ID (${targetUserId})가 올바른 형식이 아닙니다.`,
                );
                return;
            }

            const channels = specificChannel
                ? new Collection<string, GuildTextBasedChannel>([
                      [specificChannel.id, specificChannel],
                  ])
                : guild.channels.cache.filter(
                      (ch): ch is GuildTextBasedChannel =>
                          ch.isTextBased() &&
                          !ch.isThread() &&
                          ch.viewable &&
                          (ch
                              .permissionsFor(guild.members.me!)
                              ?.has(PermissionsBitField.Flags.ReadMessageHistory) ??
                              false) &&
                          (ch
                              .permissionsFor(guild.members.me!)
                              ?.has(PermissionsBitField.Flags.ManageMessages) ??
                              false),
                  );

            if (channels.size === 0) {
                logger.warn(
                    `${logPrefix} No accessible channels found for deletion in guild ${targetGuildId}`,
                );
                await interaction.editReply(
                    `오류: 이 서버에서 메시지를 읽고 삭제할 수 있는 채널을 찾을 수 없습니다. (봇 권한 확인 필요)`,
                );
                return;
            }

            if (specificChannel) {
                logger.info(
                    `${logPrefix} Deleting messages only in channel ${specificChannel.id} of guild ${targetGuildId}`,
                );
                await interaction.editReply(
                    `채널 '#${specificChannel.name}' (${specificChannel.id})에서 사용자 ${targetUserId}의 메시지 삭제를 시작합니다...`,
                );
            } else {
                logger.info(
                    `${logPrefix} Found ${channels.size} accessible text channels in guild ${targetGuildId} to scan.`,
                );
                await interaction.editReply(
                    `길드 '${guild.name}' (${targetGuildId}) 내 ${channels.size}개 채널에서 사용자 ${targetUserId}의 메시지 삭제를 시작합니다... (API 제한 시 자동으로 재시도, 최종 결과는 새 메시지로 전송됩니다)`,
                );
            }

            for (const channel of channels.values()) {
                logger.debug(`${logPrefix} Scanning channel ${channel.name} (${channel.id})`);
                let lastMessageId: string | undefined = undefined;
                let fetchMore = true;
                let channelDeletedCount = 0;
                const channelStartTime = Date.now();

                while (fetchMore) {
                    try {
                        const messages: Collection<string, Message> = await channel.messages.fetch({
                            limit: 100,
                            before: lastMessageId,
                        });
                        if (messages.size === 0) {
                            fetchMore = false;
                            continue;
                        }
                        const userMessages = messages.filter(
                            (msg) => msg.author.id === targetUserId,
                        );
                        lastMessageId = messages.lastKey();

                        if (userMessages.size > 0) {
                            logger.debug(
                                `${logPrefix} Found ${userMessages.size} messages from user ${targetUserId} in batch for channel ${channel.id}`,
                            );
                            for (const message of userMessages.values()) {
                                let retries = 0;
                                let deletedSuccessfully = false;
                                while (retries < 3 && !deletedSuccessfully) {
                                    try {
                                        await message.delete();
                                        deletedCount++;
                                        channelDeletedCount++;
                                        deletedSuccessfully = true;
                                        await new Promise((resolve) =>
                                            setTimeout(resolve, 100 + Math.random() * 50),
                                        );
                                    } catch (error) {
                                        const deleteError = error as {
                                            code?: number;
                                            status?: number;
                                            retryAfter?: number;
                                            message: string;
                                        };
                                        if (deleteError.code === 10008) {
                                            deletedSuccessfully = true;
                                            break;
                                        }
                                        if (deleteError.status === 429) {
                                            retries++;
                                            const retryAfter = (deleteError.retryAfter ?? 5) * 1000;
                                            logger.warn(
                                                `${logPrefix} Rate limited deleting message ${message.id}. Retrying after ${retryAfter}ms... (Attempt ${retries}/3)`,
                                            );
                                            await interaction
                                                .followUp({
                                                    content: `API 제한으로 메시지 삭제 지연. ${retryAfter / 1000}초 후 재시도... (시도 ${retries}/3)`,
                                                    ephemeral: true,
                                                })
                                                .catch(() => {
                                                    /* empty */
                                                });
                                            await new Promise((resolve) =>
                                                setTimeout(resolve, retryAfter + 500),
                                            );
                                        } else {
                                            logger.warn(
                                                `${logPrefix} Failed to delete message ${message.id} in channel ${channel.id}: ${deleteError.message} (Code: ${deleteError.code})`,
                                            );
                                            if (
                                                !errorMessages.some((e) => e.includes(channel.id))
                                            ) {
                                                errorMessages.push(
                                                    `채널 ${channel.name} (#${channel.id}): ${deleteError.message}`,
                                                );
                                            }
                                            break;
                                        }
                                    }
                                }
                                if (!deletedSuccessfully && retries >= 3) {
                                    logger.error(
                                        `${logPrefix} Failed to delete message ${message.id} after 3 retries due to rate limits.`,
                                    );
                                    if (!errorMessages.some((e) => e.includes(message.id))) {
                                        errorMessages.push(
                                            `메시지 ${message.id} (채널 #${channel.id}): 3번 재시도 후 삭제 실패 (Rate Limit)`,
                                        );
                                    }
                                }
                            }
                        }
                        if (messages.size < 100) {
                            fetchMore = false;
                        }
                    } catch (error) {
                        const fetchError = error as Error;
                        logger.error(
                            `${logPrefix} Failed to fetch messages in channel ${channel.id}: ${fetchError.message}`,
                        );
                        if (!errorMessages.some((e) => e.includes(channel.id))) {
                            errorMessages.push(
                                `채널 ${channel.name} (#${channel.id}) 메시지 조회 중 오류: ${fetchError.message}`,
                            );
                        }
                        fetchMore = false;
                    }
                }
                const channelEndTime = Date.now();
                if (channelDeletedCount > 0) {
                    logger.info(
                        `${logPrefix} Deleted ${channelDeletedCount} messages from user ${targetUserId} in channel ${channel.id}. Took ${((channelEndTime - channelStartTime) / 1000).toFixed(2)}s.`,
                    );
                } else {
                    logger.debug(
                        `${logPrefix} No messages found/deleted for user ${targetUserId} in channel ${channel.id}. Took ${((channelEndTime - channelStartTime) / 1000).toFixed(2)}s.`,
                    );
                }
            }

            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            let finalReport = specificChannel
                ? `${interaction.user.toString()}님, 채널 #${specificChannel.name}에서 사용자 ${targetUserId}의 메시지 삭제 완료 (총 ${deletedCount}개 삭제됨). 소요 시간: ${duration}초`
                : `${interaction.user.toString()}님, 사용자 ${targetUserId}의 메시지 삭제 작업 완료 (총 ${deletedCount}개 삭제됨). 소요 시간: ${duration}초`;
            if (errorMessages.length > 0) {
                finalReport += `\n\n⚠️ **오류 발생 (${errorMessages.length}건):**\n- ${errorMessages.slice(0, 10).join('\n- ')}`;
                if (errorMessages.length > 10) {
                    finalReport += `\n- ... (${errorMessages.length - 10}개 추가 오류)`;
                }
            }
            await channelToSendResponse.send(finalReport).catch((sendError: unknown) => {
                logger.error(`${logPrefix} Failed to send final deletion report:`, sendError);
            });
            try {
                await interaction
                    .editReply('메시지 삭제 작업이 완료되었습니다. 결과를 채널에 전송했습니다.')
                    .catch(() => {
                        /* empty */
                    });
            } catch {
                /* Ignore */
            }
            const channelInfo = specificChannel ? ` channel ${specificChannel.id}` : '';
            logger.info(
                `${logPrefix} Finished message deletion for user ${targetUserId} in guild ${targetGuildId}${channelInfo}. Deleted ${deletedCount} messages with ${errorMessages.length} errors in ${duration}s.`,
            );
        } catch (error) {
            const err = error as Error;
            logger.error(
                `${logPrefix} Critical error during message deletion process for guild ${targetGuildId}, user ${targetUserId}:`,
                err,
            );
            const criticalErrorMessage = `${interaction.user.toString()}님, 메시지 삭제 처리 중 심각한 오류가 발생했습니다: ${err.message}`;
            if (channelToSendResponse) {
                await channelToSendResponse
                    .send(criticalErrorMessage)
                    .catch((sendError: unknown) => {
                        logger.error(
                            `${logPrefix} Failed to send critical error report for deletion:`,
                            sendError,
                        );
                    });
            }
            try {
                await interaction
                    .editReply(
                        '메시지 삭제 처리 중 심각한 오류가 발생했습니다. 오류 내용을 채널에 전송했습니다.',
                    )
                    .catch(() => {
                        /* empty */
                    });
            } catch {
                /* Ignore */
            }
        }
    },
};

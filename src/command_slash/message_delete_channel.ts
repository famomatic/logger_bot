import {
    SlashCommandBuilder,
    CommandInteraction,
    PermissionsBitField,
    GuildTextBasedChannel,
    Collection,
    Message,
    Client,
    ChannelType,
    SlashCommandOptionsOnlyBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
    MessageFlags,
} from 'discord.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

// 타입 정의
interface SlashCommand {
    data: SlashCommandOptionsOnlyBuilder;
    execute: (interaction: CommandInteraction, client: Client) => Promise<void>;
}

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-delete-channel')
        .setDescription('지정한 채널 ID의 모든 메시지를 삭제합니다. (매우 위험!)')
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription('메시지를 삭제할 채널의 ID')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .setDMPermission(false),

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버 내에서만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

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

        logger.info(`/message-delete-channel command executed by ${interaction.user.tag}`);

        const targetChannelId = interaction.options.getString('channel_id', true);
        const logPrefix = `[message-delete-channel ID:${targetChannelId}]`;

        let targetChannel: GuildTextBasedChannel;
        try {
            const fetchedChannel = await client.channels.fetch(targetChannelId);
            if (!fetchedChannel) {
                logger.warn(`${logPrefix} Channel with ID ${targetChannelId} not found.`);
                await interaction.reply({
                    content: `오류: ID가 ${targetChannelId}인 채널을 찾을 수 없습니다.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            if (
                !fetchedChannel.isTextBased() ||
                fetchedChannel.isDMBased() ||
                !('guild' in fetchedChannel)
            ) {
                // Check if it's a guild text-based channel
                logger.warn(
                    `${logPrefix} Channel ${targetChannelId} is not a valid guild text-based channel (Type: ${fetchedChannel.type}).`,
                );
                await interaction.reply({
                    content: `오류: ID가 ${targetChannelId}인 채널은 유효한 서버 텍스트 채널이 아닙니다. (채널 타입: ${ChannelType[fetchedChannel.type]})`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            targetChannel = fetchedChannel as GuildTextBasedChannel;
        } catch (error) {
            logger.error(`${logPrefix} Failed to fetch channel ${targetChannelId}:`, error);
            await interaction.reply({
                content: `오류: 채널 ID ${targetChannelId}를 가져오는 중 오류가 발생했습니다. ID를 확인해주세요.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        /* 현재 서버의 채널인지 확인
        if (interaction.guildId !== targetChannel.guildId) {
            logger.warn(`${logPrefix} Attempted channel-wide deletion for channel ${targetChannel.id} in guild ${targetChannel.guildId} from different guild ${interaction.guildId} by ${interaction.user.tag}`);
            await interaction.reply({ content: `오류: 이 명령어는 현재 서버(${interaction.guildId})의 채널 메시지만 삭제할 수 있습니다. 대상 채널(${targetChannel.id})이 현재 서버에 속해있지 않습니다.`, flags: [MessageFlags.Ephemeral] });
            return;
        }
        */

        // 봇 권한 확인
        const botPermissionsInChannel = targetChannel.permissionsFor(client.user!);
        if (
            !botPermissionsInChannel?.has(PermissionsBitField.Flags.ReadMessageHistory) ||
            !botPermissionsInChannel?.has(PermissionsBitField.Flags.ManageMessages)
        ) {
            logger.warn(
                `${logPrefix} Missing permissions (ReadMessageHistory or ManageMessages) in channel ${targetChannel.id} for guild ${interaction.guildId}.`,
            );
            await interaction.reply({
                content: `오류: 채널 #${targetChannel.name}에서 메시지를 읽거나 삭제할 권한이 없습니다. 봇의 권한을 확인해주세요.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (!targetChannel.viewable) {
            logger.warn(`${logPrefix} Channel ${targetChannel.id} is not viewable by the bot.`);
            await interaction.reply({
                content: `오류: 채널 #${targetChannel.name}에 접근할 수 없습니다. 봇의 채널 보기 권한을 확인해주세요.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // --- 사용자 확인 (버튼 방식) ---
        const confirmButtonId = `confirm-delete-channel-${interaction.id}-${targetChannel.id}`;
        const cancelButtonId = `cancel-delete-channel-${interaction.id}-${targetChannel.id}`;

        const confirmButton = new ButtonBuilder()
            .setCustomId(confirmButtonId)
            .setLabel(`네, #${targetChannel.name} 채널 메시지를 삭제합니다`)
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId(cancelButtonId)
            .setLabel('취소')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            confirmButton,
            cancelButton,
        );

        const reply = await interaction.reply({
            content: `**⚠️ 경고! ⚠️** 채널 \`#${targetChannel.name}\`(${targetChannel.id})의 **모든 메시지**를 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없습니다. **정말 실행하시겠습니까?**`,
            components: [row],
            flags: MessageFlags.Ephemeral,
            fetchReply: true,
        });

        try {
            const collectorFilter = (i: import('discord.js').MessageComponentInteraction) =>
                i.user.id === interaction.user.id;
            const confirmation = await reply.awaitMessageComponent({
                filter: collectorFilter,
                componentType: ComponentType.Button,
                time: 60000,
            });

            if (confirmation.customId === confirmButtonId) {
                await confirmation.update({
                    content: `⏳ 채널 #${targetChannel.name}(${targetChannel.id}) 메시지 삭제를 시작합니다... (최종 결과는 새 메시지로 전송됩니다)`,
                    components: [],
                });
                logger.info(
                    `${logPrefix} CONFIRMED via button: Initiating CHANNEL-WIDE message deletion for channel ${targetChannel.id} by ${interaction.user.tag} (${interaction.user.id})`,
                );
            } else if (confirmation.customId === cancelButtonId) {
                await confirmation.update({ content: '✅ 작업이 취소되었습니다.', components: [] });
                logger.info(
                    `${logPrefix} Channel-wide deletion cancelled by user ${interaction.user.tag} via button.`,
                );
                return;
            }
        } catch {
            logger.warn(
                `${logPrefix} Channel-wide deletion confirmation timed out for user ${interaction.user.tag}.`,
            );
            await interaction.editReply({
                content: '⏰ 60초 동안 응답이 없어 작업이 취소되었습니다.',
                components: [],
            });
            return;
        }
        // -------------------------------

        const channelToSendResponse = interaction.channel;
        if (!channelToSendResponse || !('send' in channelToSendResponse)) {
            logger.error(
                `${logPrefix} Cannot send response: Interaction channel is not text-based or lacks send permissions.`,
            );
            return;
        }

        let totalDeletedCount = 0;
        let totalErrorMessages: string[] = [];
        const channelStartTime = Date.now(); // Renamed from guildStartTime

        try {
            logger.info(
                `${logPrefix} Starting deletion for channel #${targetChannel.name} (${targetChannel.id})`,
            );
            let channelDeletedCount = 0; // This will be totalDeletedCount
            const channelErrorMessages: string[] = []; // This will be totalErrorMessages
            let lastMessageId: string | undefined = undefined;
            let fetchMore = true;
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

            while (fetchMore) {
                try {
                    const messages: Collection<string, Message> =
                        await targetChannel.messages.fetch({ limit: 100, before: lastMessageId });

                    if (messages.size === 0) {
                        fetchMore = false;
                        break;
                    }

                    lastMessageId = messages.lastKey();
                    const messagesToDelete = new Collection<string, Message>();
                    const oldMessagesToDelete: Message[] = [];

                    for (const message of messages.values()) {
                        if (message.createdTimestamp > twoWeeksAgo) {
                            messagesToDelete.set(message.id, message);
                        } else {
                            oldMessagesToDelete.push(message);
                        }
                    }

                    if (messagesToDelete.size > 0) {
                        try {
                            const deletedResult = await targetChannel.bulkDelete(
                                messagesToDelete,
                                true,
                            );
                            channelDeletedCount += deletedResult.size;
                            logger.debug(
                                `${logPrefix} Bulk deleted ${deletedResult.size} messages.`,
                            );
                            await new Promise((resolve) => setTimeout(resolve, 1100));
                        } catch (error) {
                            const bulkDeleteError = error as Error;
                            logger.error(
                                `${logPrefix} Failed to bulk delete messages:`,
                                bulkDeleteError,
                            );
                            if (!channelErrorMessages.includes('대량 삭제 실패'))
                                channelErrorMessages.push(
                                    `대량 삭제 실패 (${bulkDeleteError.message})`,
                                );
                        }
                    }

                    if (oldMessagesToDelete.length > 0) {
                        logger.debug(
                            `${logPrefix} Deleting ${oldMessagesToDelete.length} old messages individually...`,
                        );
                        for (const message of oldMessagesToDelete) {
                            let retries = 0;
                            let deletedSuccessfully = false;
                            while (retries < 3 && !deletedSuccessfully) {
                                try {
                                    await message.delete();
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
                                            `${logPrefix} Rate limited deleting old message ${message.id}. Retrying after ${retryAfter}ms... (${retries}/3)`,
                                        );
                                        await interaction
                                            .followUp({
                                                content: `API 제한, 채널 #${targetChannel.name} 오래된 메시지 삭제 지연. ${retryAfter / 1000}초 후 재시도... (${retries}/3)`,
                                                flags: MessageFlags.Ephemeral,
                                            })
                                            .catch(() => {
                                                /* empty */
                                            });
                                        await new Promise((resolve) =>
                                            setTimeout(resolve, retryAfter + 500),
                                        );
                                    } else {
                                        logger.warn(
                                            `${logPrefix} Failed to delete old message ${message.id}: ${deleteError.message} (Code: ${deleteError.code})`,
                                        );
                                        if (
                                            !channelErrorMessages.includes(
                                                `오래된 메시지 ${message.id}`,
                                            )
                                        )
                                            channelErrorMessages.push(
                                                `오래된 메시지 ${message.id} 삭제 실패: ${deleteError.message}`,
                                            );
                                        break;
                                    }
                                }
                            } // end while
                        } // end for
                    } // end if
                    if (messages.size < 100) {
                        fetchMore = false;
                    }
                } catch (error) {
                    const fetchError = error as Error;
                    logger.error(`${logPrefix} Failed to fetch messages:`, fetchError);
                    if (!channelErrorMessages.includes('메시지 조회 오류'))
                        channelErrorMessages.push(`메시지 조회 오류 (${fetchError.message})`);
                    fetchMore = false;
                }
            } // end while(fetchMore)

            totalDeletedCount = channelDeletedCount; // Assign to total for the final report
            totalErrorMessages = channelErrorMessages; // Assign to total for the final report

            const channelEndTime = Date.now(); // Renamed from guildEndTime
            const duration = ((channelEndTime - channelStartTime) / 1000).toFixed(2);

            let finalReport = `${interaction.user.toString()}님, 채널 #${targetChannel.name}(${targetChannel.id})의 메시지 삭제 작업 완료 (총 약 ${totalDeletedCount}개 삭제됨). 소요 시간: ${duration}초`;
            if (totalErrorMessages.length > 0) {
                finalReport += `\n\n⚠️ **오류 발생 (${totalErrorMessages.length}건):**\n- ${totalErrorMessages.slice(0, 10).join('\n- ')}`;
                if (totalErrorMessages.length > 10) {
                    finalReport += `\n- ... (${totalErrorMessages.length - 10}개 추가 오류)`;
                }
            }
            // Send to the channel where the command was invoked
            await channelToSendResponse.send(finalReport).catch((sendError: unknown) => {
                logger.error(
                    `${logPrefix} Failed to send final CHANNEL deletion report:`,
                    sendError,
                );
            });
            logger.info(
                `${logPrefix} Finished CHANNEL-WIDE message deletion for channel ${targetChannel.id}. Deleted ~${totalDeletedCount} messages with ${totalErrorMessages.length} errors in ${duration}s.`,
            );
        } catch (error) {
            const err = error as Error;
            logger.error(
                `${logPrefix} Critical error during CHANNEL-WIDE message deletion process for channel ${targetChannel.id}:`,
                err,
            );
            const criticalErrorMessage = `${interaction.user.toString()}님, 채널 #${targetChannel.name} 메시지 삭제 처리 중 심각한 오류가 발생했습니다: ${err.message}`;
            if (channelToSendResponse) {
                await channelToSendResponse
                    .send(criticalErrorMessage)
                    .catch((sendError: unknown) => {
                        logger.error(
                            `${logPrefix} Failed to send critical error report for CHANNEL deletion:`,
                            sendError,
                        );
                    });
            }
        }
    },
};

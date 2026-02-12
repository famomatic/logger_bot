import { SlashCommandBuilder, CommandInteraction, PermissionsBitField, GuildTextBasedChannel, Collection, Message, Client, SlashCommandOptionsOnlyBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, MessageFlags } from 'discord.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

// 타입 정의
interface SlashCommand {
    data: SlashCommandOptionsOnlyBuilder;
    execute: (interaction: CommandInteraction, client: Client) => Promise<void>;
}

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-delete-guild')
        .setDescription('지정한 서버의 모든 메시지를 삭제합니다. (매우 위험!)')
        .addStringOption(option =>
            option.setName('guild_id')
                .setDescription('메시지를 삭제할 서버의 ID')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .setDMPermission(false),

    async execute(interaction: CommandInteraction) {
        if (!interaction.isChatInputCommand()) return;
        if (!interaction.inGuild()) {
            await interaction.reply({ content: '이 명령어는 서버 내에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
            return;
        }

        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 3 && !isAdmin) {
            await interaction.reply({ content: '이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
            return;
        }

        logger.info(`/message-delete-guild command executed by ${interaction.user.tag}`);

        const targetGuildId = interaction.options.getString('guild_id', true);
        const logPrefix = '[message-delete-guild]';

        /* 현재 서버 ID와 입력된 서버 ID 일치 확인 (필수!)
        if (interaction.guildId !== targetGuildId) {
            logger.warn(`${logPrefix} Attempted guild-wide deletion for guild ${targetGuildId} from different guild ${interaction.guildId} by ${interaction.user.tag}`);
            await interaction.reply({ content: `오류: 이 명령어는 현재 서버(${interaction.guildId})의 메시지만 삭제할 수 있습니다. 대상 서버 ID(${targetGuildId})가 일치하지 않습니다.`, flags: MessageFlags.Ephemeral });
            return;
        }
        */

        // --- 사용자 확인 (버튼 방식) ---
        const confirmButtonId = `confirm-delete-guild-${interaction.id}`;
        const cancelButtonId = `cancel-delete-guild-${interaction.id}`;

        const confirmButton = new ButtonBuilder()
            .setCustomId(confirmButtonId)
            .setLabel('네, 서버 전체 메시지를 삭제합니다')
            .setStyle(ButtonStyle.Danger); // 위험한 작업이므로 빨간색

        const cancelButton = new ButtonBuilder()
            .setCustomId(cancelButtonId)
            .setLabel('취소')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(confirmButton, cancelButton);

        const reply = await interaction.reply({
            content: `**⚠️ 경고! ⚠️** 서버 '${interaction.guild?.name}'(${targetGuildId})의 **모든 채널**에서 **모든 메시지**를 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없습니다. **정말 실행하시겠습니까?**`, 
            components: [row],
            fetchReply: true, // 메시지 객체를 받아오기 위해 필요
            flags: MessageFlags.Ephemeral
        });

        try {
            const collectorFilter = (i: import('discord.js').MessageComponentInteraction) => i.user.id === interaction.user.id; // 명령 실행자만 버튼 클릭 가능
            const confirmation = await reply.awaitMessageComponent({
                filter: collectorFilter,
                componentType: ComponentType.Button, 
                time: 60000 // 60초 제한
            });

            if (confirmation.customId === confirmButtonId) {
                // 확인 버튼 클릭됨 -> 버튼 비활성화하고 진행 메시지 표시
                await confirmation.update({ content: `⏳ 서버 '${interaction.guild?.name}'(${targetGuildId}) 전체 메시지 삭제를 시작합니다... (매우 오래 걸릴 수 있습니다. 최종 결과는 새 메시지로 전송됩니다)`, components: [] });
                 logger.info(`${logPrefix} CONFIRMED via button: Initiating GUILD-WIDE message deletion for guild ${targetGuildId} by ${interaction.user.tag} (${interaction.user.id})`);
                // --- 실제 삭제 로직 진행 --- 
                // (이 부분은 기존 코드와 동일)
            } else if (confirmation.customId === cancelButtonId) {
                // 취소 버튼 클릭됨
                 await confirmation.update({ content: '✅ 작업이 취소되었습니다.', components: [] });
                 logger.info(`${logPrefix} Guild-wide deletion cancelled by user ${interaction.user.tag} via button.`);
                 return; // 함수 종료
            }
        } catch {
             // 타임아웃 발생 시
             logger.warn(`${logPrefix} Guild-wide deletion confirmation timed out for user ${interaction.user.tag}.`);
             await interaction.editReply({ content: '⏰ 60초 동안 응답이 없어 작업이 취소되었습니다.', components: [] });
             return; // 함수 종료
        }
        // -------------------------------

        // --- 삭제 로직 시작 --- 
        // (기존의 응답 보낼 채널 확인부터 시작)
        const channelToSendResponse = interaction.channel;
        if (!channelToSendResponse || !('send' in channelToSendResponse)) {
            logger.error(`${logPrefix} Cannot send response: Interaction channel is not text-based or lacks send permissions.`);
            // 이미 followUp 했으므로 여기서는 로그만 남김
            return;
        }

        let totalDeletedCount = 0;
        const totalErrorMessages: string[] = [];
        const guildStartTime = Date.now();

        try {
            const guild = interaction.guild; // 이미 현재 길드 ID 확인 했음
            if (!guild) { // 혹시 모르니 한번 더 확인
                logger.error(`${logPrefix} Could not find interaction guild ${targetGuildId} unexpectedly.`);
                await channelToSendResponse.send('오류: 현재 서버 정보를 가져올 수 없습니다.').catch(() => { /* empty */ });
                return;
            }

            // 봇 권한 확인 및 삭제 대상 채널 필터링
            const channelsToDeleteIn = guild.channels.cache.filter((ch): ch is GuildTextBasedChannel =>
                ch.isTextBased() &&
                !ch.isThread() && // 일단 스레드는 제외 (필요시 추가)
                ch.viewable &&
                (ch.permissionsFor(guild.members.me!)?.has(PermissionsBitField.Flags.ReadMessageHistory) ?? false) &&
                (ch.permissionsFor(guild.members.me!)?.has(PermissionsBitField.Flags.ManageMessages) ?? false)
            );

            if (channelsToDeleteIn.size === 0) {
                 logger.warn(`${logPrefix} No accessible channels with required permissions found in guild ${targetGuildId}`);
                 await channelToSendResponse.send(`오류: 이 서버에서 메시지를 읽고 삭제할 수 있는 채널을 찾을 수 없습니다. (봇 권한 확인 필요)`);
                 return;
            }

            logger.info(`${logPrefix} Found ${channelsToDeleteIn.size} accessible text channels in guild ${targetGuildId} to delete messages from.`);

            for (const channel of channelsToDeleteIn.values()) {
                logger.info(`${logPrefix} Starting deletion for channel #${channel.name} (${channel.id})`);
                let channelDeletedCount = 0;
                const channelErrorMessages: string[] = [];
                const channelStartTime = Date.now();
                let lastMessageId: string | undefined = undefined;
                let fetchMore = true;
                const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

                while (fetchMore) {
                    try {
                        const messages: Collection<string, Message> = await channel.messages.fetch({ limit: 100, before: lastMessageId });

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

                        // 14일 이내 메시지 대량 삭제
                        if (messagesToDelete.size > 0) {
                            try {
                                const deletedResult = await channel.bulkDelete(messagesToDelete, true);
                                channelDeletedCount += deletedResult.size;
                                logger.debug(`${logPrefix} [Ch: ${channel.id}] Bulk deleted ${deletedResult.size} messages.`);
                                await new Promise(resolve => setTimeout(resolve, 1100));
                            } catch (error) {
                                const bulkDeleteError = error as Error;
                                logger.error(`${logPrefix} [Ch: ${channel.id}] Failed to bulk delete messages:`, bulkDeleteError);
                                if (!channelErrorMessages.includes('대량 삭제 실패')) channelErrorMessages.push(`대량 삭제 실패 (${bulkDeleteError.message})`);
                            }
                        }

                        // 14일 이상 메시지 개별 삭제
                        if (oldMessagesToDelete.length > 0) {
                            logger.debug(`${logPrefix} [Ch: ${channel.id}] Deleting ${oldMessagesToDelete.length} old messages individually...`);
                            for (const message of oldMessagesToDelete) {
                                let retries = 0;
                                let deletedSuccessfully = false;
                                while (retries < 3 && !deletedSuccessfully) {
                                    try {
                                        await message.delete();
                                        channelDeletedCount++;
                                        deletedSuccessfully = true;
                                        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 50));
                                    } catch (error) {
                                        const deleteError = error as { code?: number; status?: number; retryAfter?: number; message: string };
                                         if (deleteError.code === 10008) { deletedSuccessfully = true; break; } // Already deleted
                                        if (deleteError.status === 429) {
                                            retries++;
                                            const retryAfter = (deleteError.retryAfter ?? 5) * 1000;
                                            logger.warn(`${logPrefix} [Ch: ${channel.id}] Rate limited deleting old message ${message.id}. Retrying after ${retryAfter}ms... (${retries}/3)`);
                                            await interaction.followUp({ content: `API 제한, 채널 #${channel.name} 오래된 메시지 삭제 지연. ${retryAfter / 1000}초 후 재시도... (${retries}/3)`, flags: MessageFlags.Ephemeral }).catch(() => { /* empty */ });
                                            await new Promise(resolve => setTimeout(resolve, retryAfter + 500));
                                        } else {
                                            logger.warn(`${logPrefix} [Ch: ${channel.id}] Failed to delete old message ${message.id}: ${deleteError.message} (Code: ${deleteError.code})`);
                                            if (!channelErrorMessages.includes(`오래된 메시지 ${message.id}`)) channelErrorMessages.push(`오래된 메시지 ${message.id} 삭제 실패: ${deleteError.message}`);
                                            break;
                                        }
                                    }
                                }
                                 if (!deletedSuccessfully && retries >= 3) {
                                    logger.error(`${logPrefix} [Ch: ${channel.id}] Failed to delete old message ${message.id} after 3 retries.`);
                                    if (!channelErrorMessages.includes(`오래된 메시지 ${message.id}`)) channelErrorMessages.push(`오래된 메시지 ${message.id}: 3번 재시도 후 삭제 실패`);
                                }
                            }
                        }

                        if (messages.size < 100) {
                            fetchMore = false;
                        }

                    } catch (error) {
                         const fetchError = error as Error;
                         logger.error(`${logPrefix} [Ch: ${channel.id}] Failed to fetch messages:`, fetchError);
                         if (!channelErrorMessages.includes('메시지 조회 오류')) channelErrorMessages.push(`메시지 조회 오류 (${fetchError.message})`);
                         fetchMore = false; // 오류 발생 시 해당 채널 중단
                    }
                } // end while(fetchMore)

                const channelEndTime = Date.now();
                totalDeletedCount += channelDeletedCount;
                if (channelErrorMessages.length > 0) {
                     totalErrorMessages.push(`채널 #${channel.name} (${channel.id}) 오류: ${channelErrorMessages.join(', ')}`);
                }
                logger.info(`${logPrefix} Finished deletion for channel #${channel.name} (${channel.id}). Deleted ~${channelDeletedCount} messages with ${channelErrorMessages.length} errors in ${((channelEndTime - channelStartTime) / 1000).toFixed(2)}s.`);

            } // end for(channel)

            const guildEndTime = Date.now();
            const duration = ((guildEndTime - guildStartTime) / 1000).toFixed(2);

            let finalReport = `${interaction.user.toString()}님, 서버 ${guild.name}(${targetGuildId})의 메시지 삭제 작업 완료 (총 약 ${totalDeletedCount}개 삭제됨). 소요 시간: ${duration}초`;
            if (totalErrorMessages.length > 0) {
                finalReport += `\n\n⚠️ **오류 발생 (${totalErrorMessages.length}건):**\n- ${totalErrorMessages.slice(0, 10).join('\n- ')}`;
                if (totalErrorMessages.length > 10) { finalReport += `\n- ... (${totalErrorMessages.length - 10}개 추가 오류)`; }
            }
            await channelToSendResponse.send(finalReport).catch((sendError: unknown) => { logger.error(`${logPrefix} Failed to send final GUILD deletion report:`, sendError); });
            logger.info(`${logPrefix} Finished GUILD-WIDE message deletion for guild ${targetGuildId}. Deleted ~${totalDeletedCount} messages with ${totalErrorMessages.length} errors in ${duration}s.`);

        } catch (error) {
            const err = error as Error;
            logger.error(`${logPrefix} Critical error during GUILD-WIDE message deletion process for guild ${targetGuildId}:`, err);
            const criticalErrorMessage = `${interaction.user.toString()}님, 서버 전체 메시지 삭제 처리 중 심각한 오류가 발생했습니다: ${err.message}`;
            if (channelToSendResponse) { await channelToSendResponse.send(criticalErrorMessage).catch((sendError: unknown) => { logger.error(`${logPrefix} Failed to send critical error report for GUILD deletion:`, sendError); }); }
        }
    },
}; 
import {
    SlashCommandBuilder,
    CommandInteraction,
    PermissionsBitField,
    GuildTextBasedChannel,
    Collection,
    Message,
    Client,
    MessageFlags,
    Guild,
} from 'discord.js';
import axios from 'axios';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';
import { storageManager } from '../storage/StorageManager.js';
import { createAttachmentStoragePath } from '../storage/attachmentPath.js';
import type { AttachmentData, SlashCommand } from '../types/commands.js';
import type { ErrorWithCode } from '../types/errors.js';

async function downloadWithRetry(url: string, maxRetries = 3): Promise<Buffer> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.debug(`Downloading attachment: ${url} (try ${attempt}/${maxRetries})`);
            const res = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(res.data);
        } catch (err) {
            lastError = err;
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to download ${url} on attempt ${attempt}: ${errorMessage}`);
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw lastError;
}

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('log-guild-messages')
        .setDescription('{guild_id} 서버의 모든 메시지를 가져와 DB에 기록합니다.')
        .addStringOption((option) =>
            option
                .setName('guild_id')
                .setDescription('메시지를 기록할 서버의 ID')
                .setRequired(true),
        )
        // 기본적으로 관리자 권한이 있는 사용자만 이 명령어를 볼 수 있도록 설정
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

        logger.info(`/log-guild-messages command executed by ${interaction.user.tag}`);

        const targetGuildId = interaction.options.getString('guild_id', true);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        logger.info(
            `Initiating bulk message logging for guild ${targetGuildId} by ${interaction.user.tag} (${interaction.user.id})`,
        );

        // --- 레거시 명령어 접두사 및 개발자 ID 미리 준비 ---
        const legacyCommandPrefixes = client.legacyCommands
            ? Array.from(client.legacyCommands.keys())
            : [];
        // --- ------------------------------------------ ---

        // --- 대상 길드 직접 가져오기 ---
        let guild: Guild;
        try {
            guild = await client.guilds.fetch(targetGuildId);
        } catch (error) {
            logger.warn(`Could not fetch target guild ${targetGuildId}:`, error);
            await interaction.editReply(
                `오류: 대상 서버 ID(${targetGuildId})를 찾을 수 없거나 봇이 해당 서버에 없습니다.`,
            );
            return;
        }
        // --------------------------

        // --- 통계 변수 초기화 ---
        let processedCount = 0;
        let newlyLoggedCount = 0;
        let errorCount = 0;
        const uniqueUserIds = new Set<string>(); // 유니크 유저 ID 저장용 Set
        const channelStats: Record<
            string,
            { processed: number; newlyLogged: number; name: string }
        > = {}; // 채널별 통계 저장용 객체 (로그용)
        const startTime = Date.now();
        // --- ---------------- ---

        try {
            const channels = guild.channels.cache.filter(
                (ch): ch is GuildTextBasedChannel =>
                    ch.isTextBased() &&
                    !ch.isThread() &&
                    ch.viewable &&
                    (ch
                        .permissionsFor(guild.members.me!)
                        ?.has(PermissionsBitField.Flags.ReadMessageHistory) ??
                        false),
            );
            const totalChannelsToProcess = channels.size; // 총 채널 수 미리 저장

            if (totalChannelsToProcess === 0) {
                logger.warn(
                    `No accessible channels with ReadMessageHistory perm found in guild ${targetGuildId}`,
                );
                await interaction.editReply(
                    `오류: 이 서버에서 메시지 기록을 읽을 수 있는 채널을 찾을 수 없습니다. (봇 권한 확인 필요)`,
                );
                return;
            }

            logger.info(
                `Found ${totalChannelsToProcess} accessible text channels in guild ${targetGuildId} to process.`,
            );
            await interaction.editReply(
                `길드 '${guild.name}' (${targetGuildId}) 내 ${totalChannelsToProcess}개 채널의 모든 메시지 확인/시작합니다... (매우 오래 걸릴 수 있습니다)`,
            );

            for (const channel of channels.values()) {
                logger.debug(`Processing channel ${channel.name} (${channel.id})`);
                let lastMessageId: string | undefined = undefined;
                let fetchMore = true;
                let channelProcessedCount = 0;
                let channelNewlyLoggedCount = 0;
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

                        lastMessageId = messages.lastKey();

                        if (messages.size > 0) {
                            logger.debug(
                                `Fetched ${messages.size} messages in batch for channel ${channel.id}`,
                            );
                            const tasks: Promise<void>[] = [];
                            for (const message of messages.values()) {
                                // --- 유저 ID 추가 ---
                                uniqueUserIds.add(message.author.id);

                                if (message.author.bot) continue;

                                const isAuthorDeveloper =
                                    config.getDevLevel(message.author.id) >= 1;
                                let isLegacyCommandByDev = false;
                                if (isAuthorDeveloper && legacyCommandPrefixes.length > 0) {
                                    const matchedPrefix = legacyCommandPrefixes.find((prefix) =>
                                        message.content.startsWith(prefix),
                                    );
                                    if (matchedPrefix) {
                                        const isExactMatch = message.content === matchedPrefix;
                                        const isFollowedBySpace = message.content.startsWith(
                                            `${matchedPrefix} `,
                                        );
                                        if (isExactMatch || isFollowedBySpace) {
                                            isLegacyCommandByDev = true;
                                        }
                                    }
                                }
                                if (isLegacyCommandByDev) {
                                    logger.debug(
                                        `Skipping logging legacy command message ${message.id} by dev ${message.author.tag}`,
                                    );
                                    continue;
                                }

                                processedCount++;
                                channelProcessedCount++;

                                const task = (async () => {
                                    try {
                                        const processedAttachments: AttachmentData[] = [];
                                        if (message.attachments.size > 0) {
                                            for (const attachment of message.attachments.values()) {
                                                let storagePath: string | null = null;
                                                let downloadError: string | null = null;
                                                if (config.storage.type) {
                                                    try {
                                                        const fileBuffer = await downloadWithRetry(
                                                            attachment.url,
                                                            3,
                                                        );
                                                        const relativePath =
                                                            createAttachmentStoragePath(
                                                                guild.id,
                                                                message.channel.id,
                                                                message.id,
                                                                attachment.id,
                                                                attachment.name,
                                                            );
                                                        storagePath = await storageManager.upload(
                                                            relativePath,
                                                            fileBuffer,
                                                        );
                                                    } catch (error) {
                                                        const err = error as Error;
                                                        downloadError =
                                                            err.message ||
                                                            'Unknown download/upload error';
                                                        logger.error(
                                                            `Failed to download/upload attachment ${attachment.id} (${attachment.name}):`,
                                                            err,
                                                        );
                                                    }
                                                }
                                                processedAttachments.push({
                                                    id: attachment.id,
                                                    storagePath,
                                                    downloadError,
                                                    filename: attachment.name,
                                                    size: attachment.size,
                                                    contentType: attachment.contentType,
                                                    discordUrl: attachment.url,
                                                });
                                            }
                                        }

                                        const reactions = message.reactions.cache.map((r) => ({
                                            emojiName: r.emoji.name,
                                            emojiId: r.emoji.id,
                                            emojiAnimated: r.emoji.animated,
                                            count: r.count,
                                        }));

                                        const dataToStore = {
                                            messageId: message.id,
                                            content: message.content,
                                            authorTag: message.author.tag,
                                            authorUsername: message.author.username,
                                            attachments: processedAttachments,
                                            stickers: message.stickers.map((s) => ({
                                                id: s.id,
                                                name: s.name,
                                                format: s.format,
                                            })),
                                            reactions: reactions,
                                        };
                                        const logged = await logEvent(
                                            'messageCreate',
                                            guild.id,
                                            message.author.id,
                                            message.channel.id,
                                            message.id,
                                            dataToStore,
                                            message.createdAt,
                                        );
                                        if (logged) {
                                            newlyLoggedCount++;
                                            channelNewlyLoggedCount++;
                                        }
                                    } catch (logError) {
                                        logger.error(
                                            `Failed to log/check message ${message.id} from channel ${channel.id}:`,
                                            logError,
                                        );
                                        errorCount++;
                                    }
                                })();
                                tasks.push(task);
                            }
                            if (tasks.length > 0) {
                                await Promise.allSettled(tasks);
                            }
                        }

                        if (messages.size < 100) {
                            fetchMore = false;
                        }
                    } catch (error) {
                        const fetchError = error as ErrorWithCode;
                        // 50013: Missing Access
                        if (
                            fetchError.code === 50013 ||
                            fetchError.message?.includes('Missing Access')
                        ) {
                            logger.warn(
                                `Skipping channel ${channel.id} (${channel.name}) due to Missing Access permissions.`,
                            );
                            fetchMore = false; // Stop fetching for this channel
                            continue;
                        }
                        logger.error(
                            `Failed to fetch messages in channel ${channel.id}: ${fetchError.message}`,
                        );
                        errorCount++;
                        fetchMore = false;
                    }
                }
                const channelEndTime = Date.now();
                // 채널별 통계 저장
                channelStats[channel.id] = {
                    processed: channelProcessedCount,
                    newlyLogged: channelNewlyLoggedCount,
                    name: channel.name,
                };
                logger.info(
                    `Finished processing channel ${channel.id} (${channel.name}). Checked ${channelProcessedCount} messages, newly logged ${channelNewlyLoggedCount}. Took ${((channelEndTime - channelStartTime) / 1000).toFixed(2)}s.`,
                );
            }

            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            const totalUniqueUsers = uniqueUserIds.size; // 총 유니크 유저 수 계산
            const durationInSeconds = parseFloat(duration); // 숫자형으로 변환

            // --- 상세 결과 메시지 생성 ---
            let finalReply = `✅ **메시지 기록 확인 완료**\n\n`;
            finalReply += `> - **처리된 채널:** ${totalChannelsToProcess}개\n`;
            finalReply += `> - **확인된 메시지 (봇 제외):** ${processedCount}개\n`; // 메시지 설명 명확화
            finalReply += `> - **새로 기록된 메시지:** ${newlyLoggedCount}개\n`;
            finalReply += `> - **활동 유저 수 (추정):** ${totalUniqueUsers}명\n`; // 유니크 ID 기준
            if (errorCount > 0) {
                finalReply += `> - **오류 발생:** ⚠️ ${errorCount}개\n`;
            }
            finalReply += `> - **총 소요 시간:** ${duration}초\n\n`;
            finalReply += `ℹ️ 자세한 채널별 내역은 봇 로그를 확인하세요.`;
            // --- ------------------- ---

            // 15분 = 900초
            if (durationInSeconds > 900) {
                logger.info(
                    `Bulk logging took longer than 15 minutes (${durationInSeconds}s). Sending result as a normal message.`,
                );
                try {
                    await interaction.channel?.send(`${interaction.user.toString()} ${finalReply}`);
                    // deferReply에 대한 응답도 필요함
                    await interaction.editReply({
                        content:
                            '✅ 작업이 완료되었으나, 15분이 초과되어 현재 채널에 일반 메시지로 결과를 전송했습니다.',
                    });
                } catch (sendError) {
                    logger.error(
                        'Failed to send normal message or edit initial reply for long-running bulk logging result:',
                        sendError,
                    );
                    // 최후의 수단으로 followUp 시도 (이것도 실패할 가능성 높음)
                    try {
                        await interaction.followUp({
                            content:
                                '작업은 완료되었으나, 결과 메시지 전송에 실패했습니다. 봇 로그를 확인해주세요.',
                            flags: MessageFlags.Ephemeral,
                        });
                    } catch (finalFallbackError) {
                        logger.error(
                            'Failed to send even a fallback follow-up message:',
                            finalFallbackError,
                        );
                    }
                }
            } else {
                try {
                    await interaction.followUp(finalReply);
                } catch (followUpError) {
                    logger.error(
                        'Failed to send detailed follow-up message for bulk logging result (under 15 mins):',
                        followUpError,
                    );
                    // 15분 미만이어도 followUp 실패 시 일반 메시지로 시도
                    try {
                        await interaction.channel?.send(
                            `${interaction.user.toString()} ${finalReply}\n\n⚠️ *자동 응답에 실패하여 일반 메시지로 전송합니다.*`,
                        );
                        await interaction.editReply({
                            content:
                                '✅ 작업이 완료되었으나, 자동 응답에 실패하여 현재 채널에 일반 메시지로 결과를 전송했습니다.',
                        });
                    } catch (fallbackSendError) {
                        logger.error(
                            'Failed to send normal message as fallback for followUp failure (under 15 mins):',
                            fallbackSendError,
                        );
                    }
                }
            }

            logger.info(
                `Finished bulk message logging check for guild ${targetGuildId}. Processed ${totalChannelsToProcess} channels, checked ${processedCount} messages (non-bot), newly logged ${newlyLoggedCount} from approx ${totalUniqueUsers} unique users with ${errorCount} errors in ${duration}s.`,
            );
        } catch (error) {
            const err = error as Error;
            logger.error(
                `Critical error during bulk message logging check for guild ${targetGuildId}:`,
                err,
            );
            try {
                const errorMessage = `메시지 기록 확인/처리 중 심각한 오류가 발생했습니다: ${String(err.message || err).substring(0, 1800)}`;
                await interaction.followUp({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral,
                });
            } catch (followUpError) {
                logger.error(
                    'Failed to send follow-up error message after critical error during logging check:',
                    followUpError,
                );
            }
        }
    },
};

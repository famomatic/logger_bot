import {
    Message,
    PermissionsBitField,
    GuildTextBasedChannel,
    Collection,
    Client,
    Sticker,
    Guild,
} from 'discord.js';
import axios from 'axios';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';
import { LegacyCommand } from '../utils/loadLegacyCommands.js';
import { storageManager } from '../storage/StorageManager.js';
import { createAttachmentStoragePath } from '../storage/attachmentPath.js';

interface AttachmentData {
    id: string;
    storagePath: string | null;
    downloadError: string | null;
    filename: string;
    size: number;
    contentType: string | null;
    discordUrl: string;
}

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

const command: LegacyCommand = {
    name: 'log-all-messages',
    async execute(message: Message) {
        const args = message.content.trim().split(/ +/).slice(2); // prefix and command removed
        const targetGuildId = args[0];
        if (!targetGuildId) {
            await message.reply('사용법: logger log-all-messages <guild_id>');
            return;
        }

        const memberPermissions = message.member?.permissions;
        const devLevel = config.getDevLevel(message.author.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 3 && !isAdmin) {
            await message.reply('이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.');
            return;
        }

        const reply = await message.reply(`길드 ${targetGuildId}의 모든 메시지를 기록합니다...`);

        const client = message.client as Client & {
            legacyCommands?: Collection<string, LegacyCommand>;
        };
        logger.info(
            `Initiating bulk message logging for guild ${targetGuildId} by ${message.author.tag} (${message.author.id})`,
        );

        const legacyCommandPrefixes = client.legacyCommands
            ? Array.from(client.legacyCommands.keys())
            : [];

        let guild: Guild;
        try {
            guild = await client.guilds.fetch(targetGuildId);
        } catch (error) {
            logger.warn(`Could not fetch target guild ${targetGuildId}:`, error);
            await reply.edit(
                `오류: 대상 서버 ID(${targetGuildId})를 찾을 수 없거나 봇이 해당 서버에 없습니다.`,
            );
            return;
        }

        let processedCount = 0;
        let newlyLoggedCount = 0;
        let errorCount = 0;
        const uniqueUserIds = new Set<string>();
        const startTime = Date.now();

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
            const totalChannelsToProcess = channels.size;
            if (totalChannelsToProcess === 0) {
                logger.warn(
                    `No accessible channels with ReadMessageHistory perm found in guild ${targetGuildId}`,
                );
                await reply.edit(
                    '오류: 이 서버에서 메시지 기록을 읽을 수 있는 채널을 찾을 수 없습니다. (봇 권한 확인 필요)',
                );
                return;
            }

            await reply.edit(
                `길드 '${guild.name}' (${targetGuildId}) 내 ${totalChannelsToProcess}개 채널의 모든 메시지를 확인합니다...`,
            );

            for (const channel of channels.values()) {
                logger.debug(`Processing channel ${channel.name} (${channel.id})`);
                let lastMessageId: string | undefined = undefined;
                let fetchMore = true;
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
                            const tasks: Promise<void>[] = [];
                            for (const msg of messages.values()) {
                                uniqueUserIds.add(msg.author.id);
                                if (msg.author.bot) continue;
                                const isAuthorDeveloper = config.getDevLevel(msg.author.id) >= 1;
                                let isLegacyCommandByDev = false;
                                if (isAuthorDeveloper && legacyCommandPrefixes.length > 0) {
                                    const matchedPrefix = legacyCommandPrefixes.find((prefix) =>
                                        msg.content.startsWith(prefix),
                                    );
                                    if (matchedPrefix) {
                                        const isExactMatch = msg.content === matchedPrefix;
                                        const isFollowedBySpace = msg.content.startsWith(
                                            `${matchedPrefix} `,
                                        );
                                        if (isExactMatch || isFollowedBySpace) {
                                            isLegacyCommandByDev = true;
                                        }
                                    }
                                }
                                if (isLegacyCommandByDev) continue;
                                processedCount++;
                                const task = (async () => {
                                    try {
                                        const processedAttachments: AttachmentData[] = [];
                                        if (msg.attachments.size > 0) {
                                            for (const attachment of msg.attachments.values()) {
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
                                                                msg.channel.id,
                                                                msg.id,
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

                                        const reactions = msg.reactions.cache.map((r) => ({
                                            emojiName: r.emoji.name,
                                            emojiId: r.emoji.id,
                                            emojiAnimated: r.emoji.animated,
                                            count: r.count,
                                        }));

                                        const dataToStore = {
                                            messageId: msg.id,
                                            content: msg.content,
                                            authorTag: msg.author.tag,
                                            authorUsername: msg.author.username,
                                            attachments: processedAttachments,
                                            stickers: msg.stickers.map((s: Sticker) => ({
                                                id: s.id,
                                                name: s.name,
                                                format: s.format,
                                            })),
                                            reactions: reactions,
                                        };
                                        const logged = await logEvent(
                                            'messageCreate',
                                            guild.id,
                                            msg.author.id,
                                            msg.channel.id,
                                            msg.id,
                                            dataToStore,
                                            msg.createdAt,
                                        );
                                        if (logged) newlyLoggedCount++;
                                    } catch (logError) {
                                        logger.error(
                                            `Failed to log/check message ${msg.id} from channel ${channel.id}:`,
                                            logError,
                                        );
                                        errorCount++;
                                    }
                                })();
                                tasks.push(task);
                            }
                            if (tasks.length > 0) await Promise.allSettled(tasks);
                        }
                        if (messages.size < 100) fetchMore = false;
                    } catch (error) {
                        const fetchError = error as { code?: number; message?: string };
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
            }

            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            const totalUniqueUsers = uniqueUserIds.size;
            let finalReply = `✅ **메시지 기록 확인 완료**\n\n`;
            finalReply += `> - **확인된 메시지 (봇 제외):** ${processedCount}개\n`;
            finalReply += `> - **새로 기록된 메시지:** ${newlyLoggedCount}개\n`;
            finalReply += `> - **활동 유저 수 (추정):** ${totalUniqueUsers}명\n`;
            if (errorCount > 0) finalReply += `> - **오류 발생:** ⚠️ ${errorCount}개\n`;
            finalReply += `> - **총 소요 시간:** ${duration}초`;
            await reply.edit(finalReply);
            logger.info(
                `Finished bulk message logging check for guild ${targetGuildId}. Processed ${processedCount} messages, newly logged ${newlyLoggedCount} with ${errorCount} errors in ${duration}s.`,
            );
        } catch (error) {
            const err = error as Error;
            logger.error(
                `Critical error during bulk message logging check for guild ${targetGuildId}:`,
                err,
            );
            await reply.edit(`오류 발생: ${String(err.message || err).substring(0, 1800)}`);
        }
    },
};

export { command };

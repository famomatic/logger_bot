import { Collection, Guild, GuildTextBasedChannel, Message } from 'discord.js';
import axios from 'axios';
import { config } from '../config/config.js';
import { logEvent } from '../db/database.js';
import { storageManager } from '../storage/StorageManager.js';
import { createAttachmentStoragePath } from '../storage/attachmentPath.js';
import type { AttachmentData } from '../types/commands.js';
import type { ChannelBackfillStat, GuildBackfillResult } from '../types/backfill.js';
import type { ErrorWithCode } from '../types/errors.js';
import type { BuildMessageCreateDataParams, MessageReactionSnapshot } from '../types/messageLog.js';
import { logger } from '../utils/logger.js';

export type { ChannelBackfillStat, GuildBackfillResult } from '../types/backfill.js';

export class NoAccessibleGuildChannelsError extends Error {
    constructor(guildId: string) {
        super(`No accessible channels found for guild ${guildId}`);
        this.name = 'NoAccessibleGuildChannelsError';
    }
}

interface GuildBackfillParams {
    guild: Guild;
    legacyCommandPrefixes: string[];
}

interface MessageBackfillOutcome {
    logged: boolean;
    failed: boolean;
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

export function isLegacyCommandByDev(message: Message, legacyCommandPrefixes: string[]): boolean {
    if (legacyCommandPrefixes.length === 0) {
        return false;
    }
    if (config.getDevLevel(message.author.id) < 1) {
        return false;
    }

    const matchedPrefix = legacyCommandPrefixes.find((prefix) =>
        message.content.startsWith(prefix),
    );
    if (!matchedPrefix) {
        return false;
    }

    return message.content === matchedPrefix || message.content.startsWith(`${matchedPrefix} `);
}

export async function buildAttachmentData(
    guildId: string,
    channelId: string,
    messageId: string,
    message: Message,
): Promise<AttachmentData[]> {
    const processedAttachments: AttachmentData[] = [];
    if (message.attachments.size === 0) {
        return processedAttachments;
    }

    for (const attachment of message.attachments.values()) {
        let storagePath: string | null = null;
        let downloadError: string | null = null;
        if (config.storage.type) {
            try {
                const fileBuffer = await downloadWithRetry(attachment.url, 3);
                const relativePath = createAttachmentStoragePath(
                    guildId,
                    channelId,
                    messageId,
                    attachment.id,
                    attachment.name,
                );
                storagePath = await storageManager.upload(relativePath, fileBuffer);
            } catch (error) {
                const err = error as Error;
                downloadError = err.message || 'Unknown download/upload error';
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

    return processedAttachments;
}

export function buildMessageCreateLogData(
    params: BuildMessageCreateDataParams,
): Record<string, unknown> {
    const { message, attachments } = params;

    return {
        messageId: message.id,
        content: message.content,
        authorTag: message.author.tag,
        authorUsername: message.author.username,
        attachments,
        stickers: message.stickers.map((s) => ({
            id: s.id,
            name: s.name,
            format: s.format,
        })),
        reactions: params.reactions ?? [],
        embeds: params.embeds ?? [],
        messageType: message.type,
        forwardedContentList: params.forwardedContentList ?? null,
        referencedMessage: params.referencedMessage ?? null,
        rawReference: params.rawReference ?? null,
    };
}

export async function processMessageCreateLog(
    guildId: string,
    channelId: string,
    message: Message,
): Promise<boolean> {
    const processedAttachments = await buildAttachmentData(guildId, channelId, message.id, message);
    const reactions: MessageReactionSnapshot[] = message.reactions.cache.map((r) => ({
        emojiName: r.emoji.name,
        emojiId: r.emoji.id,
        emojiAnimated: r.emoji.animated,
        count: r.count,
    }));

    const dataToStore = buildMessageCreateLogData({
        message,
        attachments: processedAttachments,
        reactions,
    });

    return await logEvent(
        'messageCreate',
        guildId,
        message.author.id,
        channelId,
        message.id,
        dataToStore,
        message.createdAt,
    );
}

export async function runGuildMessageBackfill({
    guild,
    legacyCommandPrefixes,
}: GuildBackfillParams): Promise<GuildBackfillResult> {
    const startTime = Date.now();
    let processedCount = 0;
    let newlyLoggedCount = 0;
    let errorCount = 0;
    const uniqueUserIds = new Set<string>();
    const channelStats: Record<string, ChannelBackfillStat> = {};

    const channels = guild.channels.cache.filter(
        (ch): ch is GuildTextBasedChannel =>
            ch.isTextBased() &&
            !ch.isThread() &&
            ch.viewable &&
            (ch.permissionsFor(guild.members.me!)?.has('ReadMessageHistory') ?? false),
    );

    if (channels.size === 0) {
        throw new NoAccessibleGuildChannelsError(guild.id);
    }

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
                const tasks: Promise<MessageBackfillOutcome>[] = [];

                for (const message of messages.values()) {
                    uniqueUserIds.add(message.author.id);

                    if (
                        message.author.bot ||
                        isLegacyCommandByDev(message, legacyCommandPrefixes)
                    ) {
                        continue;
                    }

                    processedCount++;
                    channelProcessedCount++;

                    const task = (async (): Promise<MessageBackfillOutcome> => {
                        try {
                            const logged = await processMessageCreateLog(
                                guild.id,
                                channel.id,
                                message,
                            );
                            return { logged, failed: false };
                        } catch (logError) {
                            logger.error(
                                `Failed to log/check message ${message.id} from channel ${channel.id}:`,
                                logError,
                            );
                            return { logged: false, failed: true };
                        }
                    })();

                    tasks.push(task);
                }

                if (tasks.length > 0) {
                    const outcomes = await Promise.all(tasks);
                    for (const outcome of outcomes) {
                        if (outcome.logged) {
                            newlyLoggedCount++;
                            channelNewlyLoggedCount++;
                        }
                        if (outcome.failed) {
                            errorCount++;
                        }
                    }
                }

                if (messages.size < 100) {
                    fetchMore = false;
                }
            } catch (error) {
                const fetchError = error as ErrorWithCode;
                if (fetchError.code === 50013 || fetchError.message?.includes('Missing Access')) {
                    logger.warn(
                        `Skipping channel ${channel.id} (${channel.name}) due to Missing Access permissions.`,
                    );
                    fetchMore = false;
                    continue;
                }

                logger.error(
                    `Failed to fetch messages in channel ${channel.id}: ${fetchError.message}`,
                );
                errorCount++;
                fetchMore = false;
            }
        }

        channelStats[channel.id] = {
            processed: channelProcessedCount,
            newlyLogged: channelNewlyLoggedCount,
            name: channel.name,
        };
        logger.info(
            `Finished processing channel ${channel.id} (${channel.name}). Checked ${channelProcessedCount} messages, newly logged ${channelNewlyLoggedCount}. Took ${((Date.now() - channelStartTime) / 1000).toFixed(2)}s.`,
        );
    }

    return {
        totalChannels: channels.size,
        processedCount,
        newlyLoggedCount,
        errorCount,
        uniqueUserCount: uniqueUserIds.size,
        durationSeconds: Number(((Date.now() - startTime) / 1000).toFixed(2)),
        channelStats,
    };
}

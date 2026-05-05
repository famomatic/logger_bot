import axios from 'axios';

import { config } from '../config/config.js';
import { createAttachmentStoragePath } from '../storage/attachmentPath.js';
import { storageManager } from '../storage/StorageManager.js';
import { mapWithConcurrency } from '../utils/asyncControl.js';
import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { ChannelBackfillStat, GuildBackfillResult } from '../types/backfill.js';
import type { AttachmentData } from '../types/commands.js';
import type { ErrorWithCode } from '../types/errors.js';
import type { BuildMessageCreateDataParams, MessageReactionSnapshot } from '../types/messageLog.js';
import type { Collection, Guild, GuildTextBasedChannel, Message } from 'discord.js';

/**
 * 백필 대상 길드에서 읽을 수 있는 텍스트 채널이 없을 때 발생시키는 오류입니다.
 */
export class NoAccessibleGuildChannelsError extends Error {
    constructor(guildId: string) {
        super(`No accessible channels found for guild ${guildId}`);
        this.name = 'NoAccessibleGuildChannelsError';
    }
}

interface GuildBackfillParams {
    guild: Guild;
    legacyCommandNames: string[];
}

interface MessageBackfillOutcome {
    logged: boolean;
    failed: boolean;
}

interface ChannelBackfillOutcome {
    channelId: string;
    stat: ChannelBackfillStat;
    processedCount: number;
    newlyLoggedCount: number;
    errorCount: number;
    uniqueUserIds: Set<string>;
}

async function fetchMessagesWithRetry(
    channel: GuildTextBasedChannel,
    before?: string,
): Promise<Collection<string, Message>> {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await channel.messages.fetch({
                limit: 100,
                before,
            });
        } catch (error) {
            const fetchError = error as ErrorWithCode;
            const message = String(fetchError.message ?? '');
            const isTimeout =
                message.includes('Connect Timeout') ||
                message.includes('ETIMEDOUT') ||
                message.includes('Request timed out');

            if (!isTimeout || attempt === maxAttempts) {
                throw error;
            }

            logger.warn(
                `Retrying message fetch for channel ${channel.id} after timeout (attempt ${attempt}/${maxAttempts}).`,
            );
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
    }

    throw new Error(`Unreachable: failed to fetch messages for channel ${channel.id}`);
}

/**
 * 첨부파일 다운로드를 지수형 대기(1s, 2s, 3s...)로 재시도합니다.
 */
async function downloadWithRetry(url: string, maxRetries = 3): Promise<Buffer> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.debug(`Downloading attachment: ${url} (try ${attempt}/${maxRetries})`);
            const res = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: config.messageRecovery.attachmentDownloadTimeoutMs,
                maxContentLength: config.messageRecovery.attachmentMaxBytes,
                maxBodyLength: config.messageRecovery.attachmentMaxBytes,
            });
            return Buffer.from(res.data);
        } catch (err) {
            lastError = err;
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to download ${url} on attempt ${attempt}: ${errorMessage}`);
            if (errorMessage.includes('maxContentLength')) {
                break;
            }
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw lastError;
}

export function parseLegacyCommandName(
    content: string,
    legacyCommandNames: string[],
): string | null {
    if (legacyCommandNames.length === 0 || !content.startsWith(config.legacyCommandPrefix)) {
        return null;
    }

    const args = content.slice(config.legacyCommandPrefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName || !legacyCommandNames.includes(commandName)) {
        return null;
    }

    return commandName;
}

export function parseLegacyCommandArguments(content: string, commandName: string): string[] {
    if (!content.startsWith(config.legacyCommandPrefix)) {
        return [];
    }

    const args = content.slice(config.legacyCommandPrefix.length).trim().split(/ +/);
    const parsedCommandName = args.shift()?.toLowerCase();
    return parsedCommandName === commandName ? args : [];
}

/**
 * 개발자 레거시 명령어 메시지인지 판별합니다.
 * 백필/실시간 로깅 시 관리용 명령 메시지를 제외하는 데 사용됩니다.
 */
export function isLegacyCommandByDev(message: Message, legacyCommandNames: string[]): boolean {
    if (legacyCommandNames.length === 0) {
        return false;
    }
    if (!config.superAdminIds.includes(message.author.id)) {
        return false;
    }

    return parseLegacyCommandName(message.content, legacyCommandNames) !== null;
}

/**
 * 메시지 첨부파일을 다운로드한 뒤 설정된 스토리지 백엔드로 업로드하고 메타데이터를 구성합니다.
 */
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
        {
            try {
                if (attachment.size > config.messageRecovery.attachmentMaxBytes) {
                    downloadError = `Attachment too large (${attachment.size} bytes > ${config.messageRecovery.attachmentMaxBytes} bytes)`;
                    logger.warn(
                        `Skipping oversized attachment ${attachment.id} (${attachment.name}) size=${attachment.size}`,
                    );
                } else {
                    const fileBuffer = await downloadWithRetry(attachment.url, 3);
                    const relativePath = createAttachmentStoragePath(
                        guildId,
                        channelId,
                        messageId,
                        attachment.id,
                        attachment.name,
                    );
                    storagePath = await storageManager.upload(relativePath, fileBuffer);
                }
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

/**
 * `messageCreate` 이벤트 저장용 payload를 일관된 스키마로 생성합니다.
 */
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

/**
 * 단일 메시지에 대해 첨부/리액션 정보를 포함한 `messageCreate` 로그를 DB에 기록합니다.
 */
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

/**
 * 접근 가능한 길드 텍스트 채널 전반을 순회하며 과거 메시지를 백필 로깅합니다.
 */
export async function runGuildMessageBackfill({
    guild,
    legacyCommandNames,
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
            ch.permissionsFor(guild.members.me!).has('ReadMessageHistory'),
    );

    if (channels.size === 0) {
        throw new NoAccessibleGuildChannelsError(guild.id);
    }

    const processSingleChannel = async (
        channel: GuildTextBasedChannel,
    ): Promise<ChannelBackfillOutcome> => {
        logger.debug(`Processing channel ${channel.name} (${channel.id})`);
        let lastMessageId: string | undefined = undefined;
        let fetchMore = true;
        let channelProcessedCount = 0;
        let channelNewlyLoggedCount = 0;
        let channelErrorCount = 0;
        const channelUniqueUserIds = new Set<string>();
        const channelStartTime = Date.now();

        while (fetchMore) {
            try {
                const messages = await fetchMessagesWithRetry(channel, lastMessageId);

                if (messages.size === 0) {
                    fetchMore = false;
                    continue;
                }

                lastMessageId = messages.lastKey();
                const candidates: Message[] = [];

                for (const message of messages.values()) {
                    channelUniqueUserIds.add(message.author.id);

                    if (message.author.bot || isLegacyCommandByDev(message, legacyCommandNames)) {
                        continue;
                    }

                    channelProcessedCount++;
                    candidates.push(message);
                }

                for (
                    let start = 0;
                    start < candidates.length;
                    start += config.messageRecovery.backfillConcurrency
                ) {
                    const chunk = candidates.slice(
                        start,
                        start + config.messageRecovery.backfillConcurrency,
                    );
                    const outcomes = await Promise.all(
                        chunk.map(async (message): Promise<MessageBackfillOutcome> => {
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
                        }),
                    );
                    for (const outcome of outcomes) {
                        if (outcome.logged) {
                            channelNewlyLoggedCount++;
                        }
                        if (outcome.failed) {
                            channelErrorCount++;
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
                    `Failed to fetch messages in channel ${channel.id}: ${String(fetchError.message)}`,
                );
                channelErrorCount++;
                fetchMore = false;
            }
        }

        const stat = {
            processed: channelProcessedCount,
            newlyLogged: channelNewlyLoggedCount,
            name: channel.name,
        };
        logger.info(
            `Finished processing channel ${channel.id} (${channel.name}). Checked ${channelProcessedCount} messages, newly logged ${channelNewlyLoggedCount}. Took ${((Date.now() - channelStartTime) / 1000).toFixed(2)}s.`,
        );

        return {
            channelId: channel.id,
            stat,
            processedCount: channelProcessedCount,
            newlyLoggedCount: channelNewlyLoggedCount,
            errorCount: channelErrorCount,
            uniqueUserIds: channelUniqueUserIds,
        };
    };

    const channelResults = await mapWithConcurrency(
        [...channels.values()],
        config.messageRecovery.backfillChannelConcurrency,
        async (channel) => await processSingleChannel(channel),
    );

    for (const result of channelResults) {
        channelStats[result.channelId] = result.stat;
        processedCount += result.processedCount;
        newlyLoggedCount += result.newlyLoggedCount;
        errorCount += result.errorCount;
        for (const userId of result.uniqueUserIds) {
            uniqueUserIds.add(userId);
        }
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

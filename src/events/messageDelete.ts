import { Events, AuditLogEvent } from 'discord.js';

import { mapWithConcurrency } from '../utils/asyncControl.js';
import { fetchAuditLogsCached } from '../utils/auditLogCache.js';
import { logEventIfAuthorized as logEvent, shouldLogForGuild } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { Message, PartialMessage, User, GuildAuditLogsEntry } from 'discord.js';

const deleteBuffer: (Message | PartialMessage)[] = [];
let bufferTimer: NodeJS.Timeout | null = null;
let bufferDrainRunning = false;
let droppedDeleteEvents = 0;

const DELETE_BUFFER_MAX_SIZE = 5_000;
const DELETE_BUFFER_BATCH_SIZE = 500;
const DELETE_PROCESS_CONCURRENCY_PER_GUILD = 8;

async function processBufferBatch(items: (Message | PartialMessage)[]) {
    const guildMap = new Map<string, (Message | PartialMessage)[]>();
    for (const msg of items) {
        const gid = msg.guild?.id;
        if (!gid) continue;
        if (!guildMap.has(gid)) guildMap.set(gid, []);
        guildMap.get(gid)!.push(msg);
    }

    for (const [gid, msgs] of guildMap) {
        const guild = msgs[0].guild!;
        let fetchedEntries: GuildAuditLogsEntry[] | null = null;
        try {
            const fetchedLogs = await fetchAuditLogsCached(guild, {
                limit: 5,
                type: AuditLogEvent.MessageDelete,
                ttlMs: 1_500,
            });
            fetchedEntries = [...fetchedLogs.entries.values()] as GuildAuditLogsEntry[];
        } catch (err) {
            logger.error(`Failed to fetch audit logs for guild ${gid}:`, err);
        }

        await mapWithConcurrency(msgs, DELETE_PROCESS_CONCURRENCY_PER_GUILD, async (message) => {
            await handleDelete(message, fetchedEntries);
        });
    }
}

async function drainDeleteBuffer(): Promise<void> {
    if (bufferDrainRunning) {
        return;
    }

    bufferDrainRunning = true;
    try {
        while (deleteBuffer.length > 0) {
            const items = deleteBuffer.splice(0, DELETE_BUFFER_BATCH_SIZE);
            await processBufferBatch(items);
        }
    } finally {
        bufferDrainRunning = false;
        if (deleteBuffer.length > 0) {
            bufferTimer ??= setTimeout(() => {
                bufferTimer = null;
                drainDeleteBuffer().catch((error) => {
                    logger.error('Failed to drain message delete buffer:', error);
                });
            }, 1000);
        }
    }
}

async function handleDelete(
    message: Message | PartialMessage,
    fetchedEntries: GuildAuditLogsEntry[] | null,
) {
    const eventType = 'messageDelete';
    const timestamp = new Date();
    const channelId = message.channel.id;
    const messageId = message.id;
    const guildId = message.guild?.id;

    if (!shouldLogForGuild(guildId, eventType)) {
        return;
    }

    let messageContent: string | null;
    let author: User | null = null;
    let executorId: string | null = null;
    let authorId: string | null = null;

    if (message.partial) {
        messageContent = '(삭제 시점에 캐시되지 않은 메시지)';
    } else {
        messageContent = message.content;
        author = message.author;
        authorId = author.id;
        if (fetchedEntries && message.guild) {
            const deleteLog = fetchedEntries.find(
                (entry) =>
                    entry.extra &&
                    typeof entry.extra === 'object' &&
                    'channel' in entry.extra &&
                    (entry.extra as { channel?: { id?: string } }).channel?.id === channelId &&
                    entry.targetId === authorId &&
                    entry.executor?.id !== authorId &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );
            if (deleteLog) {
                executorId = deleteLog.executor?.id ?? null;
            }
        }
    }

    const dataToStore = {
        messageId,
        channelId,
        content: messageContent,
        authorId,
        authorTag: author?.tag ?? 'Unknown Author',
        executorUserId: executorId,
    };

    try {
        const logged = await logEvent(
            eventType,
            guildId,
            executorId ?? authorId,
            channelId,
            messageId,
            dataToStore,
            timestamp,
        );
        if (logged) {
            logger.debug(
                `Logged new ${eventType} for message ${messageId} in channel ${channelId}`,
            );
        }
    } catch (error) {
        logger.error(
            `Error occurred while attempting to log ${eventType} for message ${messageId}:`,
            error,
        );
    }
}

const event = {
    name: Events.MessageDelete,
    execute(message: Message | PartialMessage) {
        if (!message.partial && message.author.bot) {
            return;
        }
        if (deleteBuffer.length >= DELETE_BUFFER_MAX_SIZE) {
            droppedDeleteEvents++;
            if (droppedDeleteEvents % 100 === 1) {
                logger.warn(
                    `messageDelete buffer overflow: dropped=${droppedDeleteEvents}, max=${DELETE_BUFFER_MAX_SIZE}`,
                );
            }
            return;
        }
        deleteBuffer.push(message);
        bufferTimer ??= setTimeout(() => {
            bufferTimer = null;
            drainDeleteBuffer().catch((error) => {
                logger.error('Failed to drain message delete buffer:', error);
            });
        }, 1000);
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export { event };

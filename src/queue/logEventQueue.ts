import { Redis as RedisClient } from 'ioredis';
import { config } from '../config/config.js';
import {
    insertLogEventDirectNow,
    insertLogEventsBatch,
    setLogEventDispatcher,
    type LogEventRecord,
} from '../db/database.js';
import { logger } from '../utils/logger.js';

interface QueuedLogEvent {
    event: Omit<LogEventRecord, 'timestamp'> & { timestamp: string };
    attempts: number;
    queuedAt: string;
}

interface BufferedQueueItem {
    raw: string;
    payload: QueuedLogEvent;
}

class RedisLogQueue {
    private readonly redis: RedisClient;
    private readonly pendingKey: string;
    private readonly processingKey: string;
    private readonly dlqKey: string;
    private readonly batchSize: number;
    private readonly flushIntervalMs: number;
    private readonly maxRetries: number;

    private running = false;
    private workerPromise: Promise<void> | null = null;
    private flushTimer: NodeJS.Timeout | null = null;
    private flushInProgress = false;
    private buffer: BufferedQueueItem[] = [];

    constructor() {
        const baseKey = config.redis.queueName;
        this.pendingKey = `${baseKey}:pending`;
        this.processingKey = `${baseKey}:processing`;
        this.dlqKey = `${baseKey}:dlq`;
        this.batchSize = Math.max(1, config.redis.batchSize);
        this.flushIntervalMs = Math.max(100, config.redis.flushIntervalMs);
        this.maxRetries = Math.max(0, config.redis.maxRetries);

        this.redis = new RedisClient({
            host: config.redis.host,
            port: config.redis.port,
            db: config.redis.db,
            password: config.redis.password,
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
        });

        this.redis.on('error', (err: unknown) => {
            logger.error('Redis queue client error:', err);
        });
    }

    async start(): Promise<void> {
        await this.redis.ping();
        this.running = true;
        this.workerPromise = this.runWorker();
        logger.info(
            `Redis log queue started (${config.redis.host}:${config.redis.port}, batch=${this.batchSize}, flush=${this.flushIntervalMs}ms)`,
        );
    }

    async stop(): Promise<void> {
        this.running = false;

        if (this.workerPromise) {
            await this.workerPromise;
            this.workerPromise = null;
        }

        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        await this.flush('shutdown');
        await this.redis.quit();
        logger.info('Redis log queue stopped.');
    }

    async enqueue(event: LogEventRecord): Promise<boolean> {
        const payload: QueuedLogEvent = {
            event: {
                ...event,
                timestamp: event.timestamp.toISOString(),
            },
            attempts: 0,
            queuedAt: new Date().toISOString(),
        };

        try {
            await this.redis.lpush(this.pendingKey, JSON.stringify(payload));
            return true;
        } catch (error) {
            logger.error('Failed to enqueue log event:', error);
            return false;
        }
    }

    private async runWorker(): Promise<void> {
        while (this.running) {
            try {
                const raw = await this.redis.brpoplpush(this.pendingKey, this.processingKey, 1);
                if (!raw) {
                    await this.flush('time');
                    continue;
                }

                const parsed = this.parsePayload(raw);
                if (!parsed) {
                    await this.redis.lrem(this.processingKey, 1, raw);
                    continue;
                }

                this.buffer.push({ raw, payload: parsed });
                this.ensureFlushTimer();

                if (this.buffer.length >= this.batchSize) {
                    await this.flush('size');
                }
            } catch (error) {
                logger.error('Log queue worker loop failed:', error);
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
    }

    private parsePayload(raw: string): QueuedLogEvent | null {
        try {
            const parsed = JSON.parse(raw) as QueuedLogEvent;
            if (!parsed?.event?.guildId || !parsed.event.eventType || !parsed.event.targetId) {
                logger.warn('Discarding malformed queued log event payload.');
                return null;
            }
            return parsed;
        } catch (error) {
            logger.error('Failed to parse queued log event payload:', error);
            return null;
        }
    }

    private ensureFlushTimer(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            void this.flush('time');
        }, this.flushIntervalMs);
    }

    private clearFlushTimer(): void {
        if (!this.flushTimer) return;
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
    }

    private async flush(reason: 'size' | 'time' | 'shutdown'): Promise<void> {
        if (this.flushInProgress || this.buffer.length === 0) {
            return;
        }

        this.flushInProgress = true;
        this.clearFlushTimer();

        const items = this.buffer.splice(0, this.batchSize);
        const events: LogEventRecord[] = items.map(({ payload }) => ({
            ...payload.event,
            timestamp: new Date(payload.event.timestamp),
        }));

        try {
            const insertedCount = await insertLogEventsBatch(events);
            await this.ackProcessed(items);
            logger.debug(
                `Flushed ${items.length} log events (${insertedCount} inserted, reason=${reason})`,
            );
        } catch (error) {
            logger.error(`Failed to flush ${items.length} queued log events:`, error);
            await this.handleFlushFailure(items);
        } finally {
            this.flushInProgress = false;
            if (this.buffer.length > 0) {
                if (this.buffer.length >= this.batchSize) {
                    await this.flush('size');
                } else {
                    this.ensureFlushTimer();
                }
            }
        }
    }

    private async ackProcessed(items: BufferedQueueItem[]): Promise<void> {
        if (items.length === 0) return;
        const pipeline = this.redis.pipeline();
        for (const item of items) {
            pipeline.lrem(this.processingKey, 1, item.raw);
        }
        await pipeline.exec();
    }

    private async handleFlushFailure(items: BufferedQueueItem[]): Promise<void> {
        const pipeline = this.redis.pipeline();

        for (const item of items) {
            const nextPayload: QueuedLogEvent = {
                ...item.payload,
                attempts: item.payload.attempts + 1,
            };

            if (nextPayload.attempts > this.maxRetries) {
                pipeline.lpush(this.dlqKey, JSON.stringify(nextPayload));
            } else {
                pipeline.lpush(this.pendingKey, JSON.stringify(nextPayload));
            }

            pipeline.lrem(this.processingKey, 1, item.raw);
        }

        await pipeline.exec();
    }
}

let queueInstance: RedisLogQueue | null = null;

export function isLogQueueRunning(): boolean {
    return queueInstance !== null;
}

export async function initializeLogQueue(): Promise<void> {
    if (!config.redis.enabled) {
        setLogEventDispatcher(null);
        logger.info('Redis log queue is disabled. Using direct DB writes.');
        return;
    }

    if (queueInstance) {
        return;
    }

    const queue = new RedisLogQueue();
    await queue.start();

    setLogEventDispatcher(async (event) => {
        const queued = await queue.enqueue(event);
        if (queued) {
            return true;
        }
        logger.warn('Queue enqueue failed. Falling back to direct log write.');
        return await insertLogEventDirectNow(event);
    });
    queueInstance = queue;
}

export async function shutdownLogQueue(): Promise<void> {
    setLogEventDispatcher(null);

    if (!queueInstance) {
        return;
    }

    await queueInstance.stop();
    queueInstance = null;
}

export async function restartLogQueue(): Promise<void> {
    await shutdownLogQueue();
    await initializeLogQueue();
}

import { randomUUID } from 'node:crypto';

import { Redis as RedisClient } from 'ioredis';

import { config } from '../config/config.js';
import {
    insertLogEventDirectNow,
    insertLogEventsBatch,
    setLogEventDispatcher,
} from '../db/database.js';
import { logger } from '../utils/logger.js';

import type { LogEventRecord } from '../types/logs.js';

interface QueuedLogEvent {
    event: Omit<LogEventRecord, 'timestamp'> & { timestamp: string };
    attempts: number;
    queuedAt: string;
}

interface BufferedQueueItem {
    raw: string;
    payload: QueuedLogEvent;
}

export interface LogQueueStats {
    pending: number;
    processing: number;
    dlq: number;
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
        if (config.redis.clearOnStartup) {
            await this.clearStaleQueueState();
        }
        if (!config.redis.clearOnStartup && config.redis.dlqRedriveOnStartup) {
            const redriven = await this.redriveDlq(config.redis.dlqRedriveBatchSize);
            if (redriven > 0) {
                logger.warn(`Redriven ${redriven} events from DLQ to pending on startup.`);
            }
        }
        await this.recoverProcessingQueue();
        this.running = true;
        this.workerPromise = this.runWorker();
        logger.info(
            `Redis log queue started (${config.redis.host}:${config.redis.port}, batch=${this.batchSize}, flush=${this.flushIntervalMs}ms)`,
        );
    }

    private async clearStaleQueueState(): Promise<void> {
        const [pending, processing] = await Promise.all([
            this.redis.llen(this.pendingKey),
            this.redis.llen(this.processingKey),
        ]);

        if (pending === 0 && processing === 0) {
            return;
        }

        await this.redis.del(this.pendingKey, this.processingKey);
        logger.warn(
            `Cleared stale redis queue state on startup (pending=${pending}, processing=${processing}).`,
        );
    }

    async getStats(): Promise<LogQueueStats> {
        const [pending, processing, dlq] = await Promise.all([
            this.redis.llen(this.pendingKey),
            this.redis.llen(this.processingKey),
            this.redis.llen(this.dlqKey),
        ]);
        return { pending, processing, dlq };
    }

    async redriveDlq(maxItems: number): Promise<number> {
        const limit = Math.max(1, maxItems);
        let moved = 0;
        const pipeline = this.redis.pipeline();

        while (moved < limit) {
            const raw = await this.redis.rpop(this.dlqKey);
            if (!raw) {
                break;
            }

            const payload = this.parsePayload(raw);
            if (!payload) {
                continue;
            }

            payload.attempts = 0;
            payload.queuedAt = new Date().toISOString();
            pipeline.lpush(this.pendingKey, JSON.stringify(payload));
            moved++;
        }

        if (moved > 0) {
            await pipeline.exec();
        }
        return moved;
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

    private async recoverProcessingQueue(): Promise<void> {
        let recovered = 0;
        for (;;) {
            const moved = await this.redis.lmove(
                this.processingKey,
                this.pendingKey,
                'RIGHT',
                'LEFT',
            );
            if (!moved) {
                break;
            }
            recovered++;
        }

        if (recovered > 0) {
            logger.warn(
                `Recovered ${recovered} orphaned log events from processing queue back to pending queue.`,
            );
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
            if (!parsed.event.guildId || !parsed.event.eventType) {
                logger.warn('Discarding malformed queued log event payload.');
                return null;
            }
            if (!parsed.event.eventId) {
                // Backward compatibility for pre-cutover queued payloads.
                parsed.event.eventId = randomUUID();
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
            this.flush('time').catch((error) => {
                logger.error('Failed to flush log queue on timer:', error);
            });
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

/**
 * Redis 로그 큐 사용 여부(초기화 완료 상태)를 반환합니다.
 */
export function isLogQueueRunning(): boolean {
    return queueInstance !== null;
}

/**
 * 설정에 따라 Redis 로그 큐를 시작하고 DB 디스패처를 큐 경로로 연결합니다.
 */
export async function initializeLogQueue(): Promise<void> {
    if (!config.redis.enabled) {
        if (config.distributedMode) {
            throw new Error(
                'Redis log queue must be enabled when DISTRIBUTED_MODE=true (fail-closed policy).',
            );
        }
        setLogEventDispatcher(null);
        logger.info('Redis log queue is disabled. Using direct DB writes.');
        return;
    }

    if (queueInstance) {
        return;
    }

    const queue = new RedisLogQueue();
    try {
        await queue.start();
    } catch (error) {
        if (config.distributedMode) {
            logger.error(
                'Failed to start Redis log queue in distributed mode; aborting process by fail-closed policy.',
                error,
            );
            throw new Error(
                'Failed to start Redis log queue in distributed mode; aborting process by fail-closed policy.',
            );
        }
        logger.error(
            'Failed to start Redis log queue. Falling back to direct DB writes for this process.',
            error,
        );
        setLogEventDispatcher(null);
        return;
    }

    setLogEventDispatcher(async (event) => {
        const queued = await queue.enqueue(event);
        if (queued) {
            return true;
        }
        if (config.distributedMode) {
            logger.error(
                'Queue enqueue failed in distributed mode. Direct DB fallback is blocked by fail-closed policy.',
            );
            return false;
        }
        logger.warn('Queue enqueue failed. Falling back to direct log write.');
        return await insertLogEventDirectNow(event);
    });
    queueInstance = queue;
}

/**
 * 현재 로그 큐 길이 상태(pending/processing/dlq)를 조회합니다.
 */
export async function getLogQueueStats(): Promise<LogQueueStats | null> {
    if (!config.redis.enabled) {
        return null;
    }
    if (!queueInstance) {
        return null;
    }
    try {
        return await queueInstance.getStats();
    } catch (error) {
        logger.error('Failed to query log queue stats:', error);
        return null;
    }
}

/**
 * DLQ에서 pending 큐로 이벤트를 재주입합니다.
 */
export async function redriveLogQueueDlq(maxItems: number): Promise<number> {
    if (!config.redis.enabled || !queueInstance) {
        return 0;
    }
    try {
        return await queueInstance.redriveDlq(maxItems);
    } catch (error) {
        logger.error('Failed to redrive log queue DLQ:', error);
        return 0;
    }
}

/**
 * 로그 큐를 중지하고 DB 디스패처를 직접 쓰기 모드로 되돌립니다.
 */
export async function shutdownLogQueue(): Promise<void> {
    setLogEventDispatcher(null);

    if (!queueInstance) {
        return;
    }

    await queueInstance.stop();
    queueInstance = null;
}

/**
 * 로그 큐를 재시작합니다.
 */
export async function restartLogQueue(): Promise<void> {
    await shutdownLogQueue();
    await initializeLogQueue();
}

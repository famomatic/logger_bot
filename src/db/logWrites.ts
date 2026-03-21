import { createHash, randomUUID } from 'node:crypto';

import { isGuildAuthorized } from './accessControl.js';
import { pool } from './pool.js';
import { queueAlertDispatch } from '../utils/alertManager.js';
import { discordClient } from '../utils/discordClient.js';
import { logger } from '../utils/logger.js';

import type { BatchInsertedLogRow } from '../types/dbRows.js';
import type { PgError } from '../types/errors.js';
import type { LogEventRecord } from '../types/logs.js';

type LogEventDispatcher = (event: LogEventRecord) => Promise<boolean>;

let logEventDispatcher: LogEventDispatcher | null = null;

const TARGET_ID_MAX_LENGTH = 30;

/**
 * 로그 저장 경로를 외부 디스패처(큐 등)로 위임할 때 사용할 핸들러를 등록합니다.
 */
export function setLogEventDispatcher(dispatcher: LogEventDispatcher | null): void {
    logEventDispatcher = dispatcher;
}

/**
 * DB 컬럼 길이 제한(30자)을 넘는 target_id를 해시 접미사로 축약합니다.
 */
function normalizeTargetId(targetId: string | null): string | null {
    if (targetId === null) {
        return null;
    }

    if (targetId.length <= TARGET_ID_MAX_LENGTH) {
        return targetId;
    }

    const hash = createHash('sha1').update(targetId).digest('hex').slice(0, 8);
    const prefixLength = TARGET_ID_MAX_LENGTH - (hash.length + 1);
    return `${targetId.slice(0, prefixLength)}_${hash}`;
}

function toDeterministicUuid(source: string): string {
    const digest = createHash('sha256').update(source).digest('hex').slice(0, 32).split('');
    digest[12] = '4'; // UUID version 4
    const variant = parseInt(digest[16], 16);
    digest[16] = ((variant & 0x3) | 0x8).toString(16); // RFC 4122 variant
    const hex = digest.join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function resolveEventId(
    eventType: string,
    guildId: string,
    targetId: string | null,
    channelId: string | null,
): string {
    // messageCreate는 재복구/재백필 시 동일 이벤트를 중복 적재하지 않도록 결정적 ID를 사용한다.
    if (eventType === 'messageCreate' && targetId) {
        return toDeterministicUuid(`messageCreate|${guildId}|${channelId ?? 'none'}|${targetId}`);
    }
    return randomUUID();
}

/**
 * 로그 이벤트 입력을 DB 저장 가능한 정규화 구조로 변환합니다.
 */
function normalizeLogEvent(
    eventType: string,
    guildId: string,
    userId: string | null,
    channelId: string | null,
    targetId: string | null,
    data: Record<string, unknown>,
    timestamp: Date,
): LogEventRecord {
    const normalizedTargetId = normalizeTargetId(targetId);
    return {
        eventId: resolveEventId(eventType, guildId, normalizedTargetId, channelId),
        eventType,
        guildId,
        userId,
        channelId,
        targetId: normalizedTargetId,
        data,
        timestamp,
    };
}

/**
 * 이벤트 1건을 즉시 DB에 삽입합니다.
 */
async function insertLogEventDirect(event: LogEventRecord): Promise<boolean> {
    const insertQuery = `
    INSERT INTO event_logs (event_id, event_type, guild_id, user_id, channel_id, target_id, data, "timestamp")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING id;
  `;
    const normalizedTargetId = normalizeTargetId(event.targetId);
    const values = [
        event.eventId,
        event.eventType,
        event.guildId,
        event.userId,
        event.channelId,
        normalizedTargetId,
        event.data,
        event.timestamp,
    ];

    try {
        const result = await pool.query(insertQuery, values);
        const inserted = (result.rowCount ?? 0) > 0;
        if (inserted) {
            queueAlertDispatch(
                event.eventType,
                event.guildId,
                event.userId,
                event.channelId,
                event.targetId,
                event.data,
                event.timestamp,
                discordClient,
            );
        }
        return inserted;
    } catch (error: unknown) {
        logOriginalError(error, event.eventType, event.targetId, event.guildId);
        return false;
    }
}

/**
 * 정규화된 로그 이벤트 1건을 즉시 DB에 기록합니다.
 */
export async function insertLogEventDirectNow(event: LogEventRecord): Promise<boolean> {
    return await insertLogEventDirect(event);
}

/**
 * 로그 이벤트 여러 건을 벌크 insert로 저장하고, 성공 건만 경보 디스패치합니다.
 */
export async function insertLogEventsBatch(events: LogEventRecord[]): Promise<number> {
    if (events.length === 0) {
        return 0;
    }

    const values: unknown[] = [];
    const rows = events.map((event, index) => {
        const base = index * 8;
        const normalizedTargetId = normalizeTargetId(event.targetId);
        values.push(
            event.eventId,
            event.eventType,
            event.guildId,
            event.userId,
            event.channelId,
            normalizedTargetId,
            event.data,
            event.timestamp,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
    });

    const insertQuery = `
      INSERT INTO event_logs (event_id, event_type, guild_id, user_id, channel_id, target_id, data, "timestamp")
      VALUES ${rows.join(', ')}
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id, event_type, guild_id, user_id, channel_id, target_id, data, "timestamp"
    `;

    try {
        const result = await pool.query<BatchInsertedLogRow>(insertQuery, values);
        const insertedRows = result.rows;

        for (const row of insertedRows) {
            queueAlertDispatch(
                row.event_type,
                row.guild_id,
                row.user_id,
                row.channel_id,
                row.target_id,
                row.data,
                row.timestamp,
                discordClient,
            );
        }

        return insertedRows.length;
    } catch (error) {
        logger.error('Bulk log insert failed:', error);
        throw error;
    }
}

/**
 * Logs an event to the database. If a dispatcher is registered, it forwards to the dispatcher first.
 */
export async function logEvent(
    eventType: string,
    guildId: string,
    userId: string | null,
    channelId: string | null,
    targetId: string | null,
    data: Record<string, unknown>,
    timestamp: Date,
): Promise<boolean> {
    if (!isGuildAuthorized(guildId)) {
        logger.debug(`Skipping logEvent for unauthorized guild ${guildId}`);
        return false;
    }

    const event = normalizeLogEvent(
        eventType,
        guildId,
        userId,
        channelId,
        targetId,
        data,
        timestamp,
    );
    if (logEventDispatcher) {
        return await logEventDispatcher(event);
    }

    return await insertLogEventDirect(event);
}

/**
 * DB 삽입 실패 원본 오류를 표준/비표준 객체 모두 로깅합니다.
 */
function logOriginalError(
    error: unknown,
    eventType: string,
    targetId: string | null,
    guildId: string,
) {
    const errorMessage = `Error logging event ${eventType} for target ${targetId ?? 'N/A'} in guild ${guildId}:`;
    if (error instanceof Error) {
        const pgErr = error as PgError;
        logger.error(errorMessage, {
            type: 'Standard Error',
            message: error.message,
            stack: error.stack,
            code: pgErr.code,
            detail: pgErr.detail,
        });
    } else {
        try {
            logger.error(
                errorMessage + ` (Non-standard error object: type=${typeof error})`,
                JSON.stringify(error),
            );
        } catch {
            logger.error(errorMessage + ` (Non-standard error object, could not stringify)`, error);
        }
    }
}

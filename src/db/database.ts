import { createHash, randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import pkg from 'pg';

import { config } from '../config/config.js';
import { dispatchAlert } from '../utils/alertManager.js';
import { discordClient } from '../utils/discordClient.js';
import { logger } from '../utils/logger.js';

import type { AlertSubscriptionRow } from '../types/alerts.js';
import type { GuildLogStats } from '../types/database.js';
import type {
    BatchInsertedLogRow,
    CountRow,
    FetchedLogRow,
    GuildLogStatsRow,
    LatestMessageCreateCheckpointRow,
    RankedEventTypeRow,
    RankedRow,
    ScopeSummaryRow,
} from '../types/dbRows.js';
import type { PgError } from '../types/errors.js';
import type { LogEntry, LogEventRecord, LogScopeReport, SearchLogsParams } from '../types/logs.js';

const { Pool } = pkg;

dotenv.config();

const pool = new Pool({
    user: config.dbUser,
    password: config.dbPassword,
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    ssl: config.dbSsl ? { rejectUnauthorized: config.dbSslRejectUnauthorized } : false,
});

pool.on('connect', () => {
    logger.info('Database pool connected');
});

pool.on('error', (err, client) => {
    logger.error('Unexpected error on idle database client', { error: err, clientInfo: client });
    // process.exit(-1); // Consider if critical error requires exit
});

// --- Authorized Guild Cache ---
let authorizedGuildIds = new Set<string>();
let authorizedGuildIdsLoaded = false;

/**
 * `authorized_guilds` 테이블을 읽어 메모리 캐시를 초기화합니다.
 */
export async function loadAuthorizedGuildIds(): Promise<void> {
    try {
        const res = await pool.query('SELECT guild_id FROM authorized_guilds');
        authorizedGuildIds = new Set(res.rows.map((r: { guild_id: string }) => r.guild_id));
        authorizedGuildIdsLoaded = true;
        logger.info(`Loaded ${authorizedGuildIds.size} authorized guild IDs.`);
    } catch (error) {
        authorizedGuildIdsLoaded = false;
        logger.error('Failed to load authorized guild IDs:', error);
        throw error;
    }
}

/**
 * authorized_guilds 캐시가 정상 로드되었는지 반환합니다.
 */
export function isAuthorizedGuildCacheLoaded(): boolean {
    return authorizedGuildIdsLoaded;
}

/**
 * 길드가 로깅 허용 대상인지 메모리 캐시 기준으로 확인합니다.
 */
export function isGuildAuthorized(guildId: string): boolean {
    return authorizedGuildIds.has(guildId);
}

/**
 * 길드 ID를 로깅 허용 목록(DB + 메모리 캐시)에 등록합니다.
 */
export async function authorizeGuildId(guildId: string): Promise<void> {
    try {
        await pool.query(
            'INSERT INTO authorized_guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING',
            [guildId],
        );
        authorizedGuildIds.add(guildId);
    } catch (error) {
        logger.error(`Failed to authorize guild ${guildId}:`, error);
    }
}

/**
 * 길드 ID를 로깅 허용 목록(DB + 메모리 캐시)에서 제거합니다.
 */
export async function unauthorizeGuildId(guildId: string): Promise<void> {
    try {
        await pool.query('DELETE FROM authorized_guilds WHERE guild_id = $1', [guildId]);
        authorizedGuildIds.delete(guildId);
    } catch (error) {
        logger.error(`Failed to unauthorize guild ${guildId}:`, error);
    }
}

export interface CommandPermissionRow {
    guildId: string;
    commandName: string;
    userId: string;
}

/**
 * 명령어별 사용자 허용 권한을 추가합니다.
 */
export async function grantCommandPermission(
    guildId: string,
    commandName: string,
    userId: string,
): Promise<void> {
    try {
        await pool.query(
            `
            INSERT INTO command_permissions (guild_id, command_name, user_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, command_name, user_id) DO NOTHING
            `,
            [guildId, commandName, userId],
        );
    } catch (error) {
        logger.error(
            `Failed to grant command permission guild=${guildId} command=${commandName} user=${userId}:`,
            error,
        );
        throw error;
    }
}

/**
 * 명령어별 사용자 허용 권한을 제거합니다.
 */
export async function revokeCommandPermission(
    guildId: string,
    commandName: string,
    userId: string,
): Promise<void> {
    try {
        await pool.query(
            `DELETE FROM command_permissions WHERE guild_id = $1 AND command_name = $2 AND user_id = $3`,
            [guildId, commandName, userId],
        );
    } catch (error) {
        logger.error(
            `Failed to revoke command permission guild=${guildId} command=${commandName} user=${userId}:`,
            error,
        );
        throw error;
    }
}

/**
 * 사용자가 길드에서 특정 명령어 실행 권한을 갖는지 확인합니다.
 */
export async function hasCommandPermission(
    guildId: string,
    commandName: string,
    userId: string,
): Promise<boolean> {
    try {
        const result = await pool.query<{ exists: boolean }>(
            `
            SELECT EXISTS (
                SELECT 1
                FROM command_permissions
                WHERE guild_id = $1 AND command_name = $2 AND user_id = $3
            ) AS exists
            `,
            [guildId, commandName, userId],
        );
        return result.rows[0]?.exists === true;
    } catch (error) {
        logger.error(
            `Failed to check command permission guild=${guildId} command=${commandName} user=${userId}:`,
            error,
        );
        return false;
    }
}

/**
 * 특정 사용자가 길드에서 허용된 명령어 목록을 조회합니다.
 */
export async function listCommandPermissionsByUser(
    guildId: string,
    userId: string,
): Promise<string[]> {
    try {
        const result = await pool.query<{ command_name: string }>(
            `
            SELECT command_name
            FROM command_permissions
            WHERE guild_id = $1 AND user_id = $2
            ORDER BY command_name ASC
            `,
            [guildId, userId],
        );
        return result.rows.map((row) => row.command_name);
    } catch (error) {
        logger.error(
            `Failed to list command permissions for user=${userId} in guild=${guildId}:`,
            error,
        );
        return [];
    }
}

/**
 * 특정 명령어를 길드에서 사용할 수 있는 사용자 목록을 조회합니다.
 */
export async function listCommandPermissionsByCommand(
    guildId: string,
    commandName: string,
): Promise<string[]> {
    try {
        const result = await pool.query<{ user_id: string }>(
            `
            SELECT user_id
            FROM command_permissions
            WHERE guild_id = $1 AND command_name = $2
            ORDER BY user_id ASC
            `,
            [guildId, commandName],
        );
        return result.rows.map((row) => row.user_id);
    } catch (error) {
        logger.error(
            `Failed to list command permissions for command=${commandName} in guild=${guildId}:`,
            error,
        );
        return [];
    }
}

// --- Alert Subscriptions ---

/**
 * 경보 카테고리 구독 채널을 등록합니다.
 */
export async function addAlertSubscription(
    guildId: string,
    category: string,
    channelId: string,
): Promise<void> {
    try {
        await pool.query(
            'INSERT INTO alert_subscriptions (guild_id, channel_id, category) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [guildId, channelId, category],
        );
    } catch (error) {
        logger.error('Failed to add alert subscription:', error);
    }
}

/**
 * 경보 카테고리 구독 채널을 해제합니다.
 */
export async function removeAlertSubscription(
    guildId: string,
    category: string,
    channelId: string,
): Promise<void> {
    try {
        await pool.query(
            'DELETE FROM alert_subscriptions WHERE guild_id = $1 AND channel_id = $2 AND category = $3',
            [guildId, channelId, category],
        );
    } catch (error) {
        logger.error('Failed to remove alert subscription:', error);
    }
}

/**
 * 전체 경보 구독 목록을 조회합니다.
 */
export async function fetchAlertSubscriptions(): Promise<AlertSubscriptionRow[]> {
    try {
        const res = await pool.query<AlertSubscriptionRow>(
            'SELECT guild_id, channel_id, category FROM alert_subscriptions',
        );
        return res.rows;
    } catch (error) {
        logger.error('Failed to fetch alert subscriptions:', error);
        return [];
    }
}

/**
 * 채널별 최신 `messageCreate` 로그 target_id를 체크포인트로 조회합니다.
 */
export async function fetchLatestMessageCreateTargetIdsByChannel(
    guildId: string,
): Promise<Map<string, string>> {
    try {
        const result = await pool.query<LatestMessageCreateCheckpointRow>(
            `
            SELECT DISTINCT ON (channel_id) channel_id, target_id
            FROM event_logs
            WHERE guild_id = $1
              AND event_type = 'messageCreate'
              AND channel_id IS NOT NULL
            ORDER BY channel_id, "timestamp" DESC
            `,
            [guildId],
        );

        return new Map(result.rows.map((row) => [row.channel_id, row.target_id]));
    } catch (error) {
        logger.error(
            `Failed to fetch latest messageCreate checkpoints for guild ${guildId}:`,
            error,
        );
        return new Map();
    }
}

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
 * target_id가 없을 때 중복 가능성을 낮춘 합성 ID를 생성합니다.
 */
function createSyntheticTargetId(
    eventType: string,
    guildId: string,
    userId: string | null,
    channelId: string | null,
    timestamp: Date,
): string {
    const stamp = timestamp.getTime().toString(36);
    const entropy = randomUUID().replace(/-/g, '').slice(0, 12);
    const source = `${eventType}|${guildId}|${userId ?? 'system'}|${channelId ?? 'none'}|${stamp}|${entropy}`;
    const hash = createHash('sha1').update(source).digest('hex').slice(0, 24);
    return `auto_${hash}`;
}

/**
 * DB 컬럼 길이 제한(30자)을 넘는 target_id를 해시 접미사로 축약합니다.
 */
function normalizeTargetId(targetId: string): string {
    if (targetId.length <= TARGET_ID_MAX_LENGTH) {
        return targetId;
    }

    const hash = createHash('sha1').update(targetId).digest('hex').slice(0, 8);
    const prefixLength = TARGET_ID_MAX_LENGTH - (hash.length + 1);
    return `${targetId.slice(0, prefixLength)}_${hash}`;
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
    return {
        eventType,
        guildId,
        userId,
        channelId,
        targetId: normalizeTargetId(
            targetId ?? createSyntheticTargetId(eventType, guildId, userId, channelId, timestamp),
        ),
        data,
        timestamp,
    };
}

/**
 * 파티션 테이블 이름 생성 전 guildId 형식을 검증합니다.
 */
function assertValidGuildId(guildId: string): void {
    if (!/^\d+$/.test(guildId)) {
        throw new Error(`Invalid guild ID format: ${guildId}`);
    }
}

/**
 * SQL 식별자(테이블명 등) 안전 이스케이프를 수행합니다.
 */
function quoteIdentifier(input: string): string {
    return `"${input.replace(/"/g, '""')}"`;
}

/**
 * SQL 리터럴 문자열을 안전하게 이스케이프합니다.
 */
function quoteLiteral(input: string): string {
    return `'${input.replace(/'/g, "''")}'`;
}

/**
 * 길드별 리스트 파티션 테이블이 없으면 생성/attach합니다.
 */
async function ensureGuildPartition(guildId: string): Promise<void> {
    assertValidGuildId(guildId);
    const partitionTableName = `event_logs_guild_${guildId}`;
    const quotedPartitionTableName = quoteIdentifier(partitionTableName);
    const quotedGuildId = quoteLiteral(guildId);
    try {
        const createPartitionQuery = `CREATE TABLE IF NOT EXISTS ${quotedPartitionTableName} PARTITION OF event_logs FOR VALUES IN (${quotedGuildId});`;
        await pool.query(createPartitionQuery);
    } catch (error: unknown) {
        const pgErr = error as PgError;
        if (pgErr.code === '42P07') {
            const attachQuery = `ALTER TABLE event_logs ATTACH PARTITION ${quotedPartitionTableName} FOR VALUES IN (${quotedGuildId});`;
            await pool.query(attachQuery);
        } else if (pgErr.code !== '42710' && pgErr.code !== '42809') {
            throw error;
        }
    }
}

/**
 * 이벤트 1건을 즉시 DB에 삽입합니다. 파티션 누락 시 1회 복구 재시도합니다.
 */
async function insertLogEventDirect(event: LogEventRecord, isRetry = false): Promise<boolean> {
    const messageCreateConflictClause =
        "ON CONFLICT (guild_id, event_type, target_id) WHERE (event_type = 'messageCreate') DO NOTHING";
    const insertQuery =
        event.eventType === 'messageCreate'
            ? `
    INSERT INTO event_logs (event_type, guild_id, user_id, channel_id, target_id, data, "timestamp")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ${messageCreateConflictClause}
    RETURNING id;
  `
            : `
    INSERT INTO event_logs (event_type, guild_id, user_id, channel_id, target_id, data, "timestamp")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id;
  `;
    const normalizedTargetId = normalizeTargetId(event.targetId);
    const values = [
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
            dispatchAlert(
                event.eventType,
                event.guildId,
                event.userId,
                event.channelId,
                event.targetId,
                event.data,
                event.timestamp,
                discordClient,
            ).catch((alertError) => {
                logger.error('Failed to dispatch alert after single log insert:', alertError);
            });
        }
        return inserted;
    } catch (error: unknown) {
        const pgErr = error as PgError;
        if (pgErr.code === '23514' && !isRetry) {
            logger.warn(
                `Partition not found for guild ${event.guildId} while logging ${event.eventType}. Creating partition and retrying.`,
            );
            try {
                await ensureGuildPartition(event.guildId);
                return await insertLogEventDirect(event, true);
            } catch (partitionError) {
                logger.error(
                    `Failed to create partition for guild ${event.guildId}:`,
                    partitionError,
                );
                logOriginalError(error, event.eventType, event.targetId, event.guildId);
                return false;
            }
        }
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

    const uniqueGuildIds = [...new Set(events.map((event) => event.guildId))];
    await Promise.all(uniqueGuildIds.map((guildId) => ensureGuildPartition(guildId)));

    const messageCreateEvents = events.filter((event) => event.eventType === 'messageCreate');
    const otherEvents = events.filter((event) => event.eventType !== 'messageCreate');
    const insertedRows: BatchInsertedLogRow[] = [];

    const runBatchInsert = async (
        batchEvents: LogEventRecord[],
        options: { messageCreateOnly: boolean },
    ): Promise<void> => {
        if (batchEvents.length === 0) {
            return;
        }

        const values: unknown[] = [];
        const rows = batchEvents.map((event, index) => {
            const base = index * 7;
            const normalizedTargetId = normalizeTargetId(event.targetId);
            values.push(
                event.eventType,
                event.guildId,
                event.userId,
                event.channelId,
                normalizedTargetId,
                event.data,
                event.timestamp,
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
        });

        const conflictClause = options.messageCreateOnly
            ? "ON CONFLICT (guild_id, event_type, target_id) WHERE (event_type = 'messageCreate') DO NOTHING"
            : '';
        const insertQuery = `
      INSERT INTO event_logs (event_type, guild_id, user_id, channel_id, target_id, data, "timestamp")
      VALUES ${rows.join(', ')}
      ${conflictClause}
      RETURNING event_type, guild_id, user_id, channel_id, target_id, data, "timestamp"
    `;

        const result = await pool.query<BatchInsertedLogRow>(insertQuery, values);
        insertedRows.push(...result.rows);
    };

    try {
        await runBatchInsert(messageCreateEvents, { messageCreateOnly: true });
        await runBatchInsert(otherEvents, { messageCreateOnly: false });

        for (const row of insertedRows) {
            dispatchAlert(
                row.event_type,
                row.guild_id,
                row.user_id,
                row.channel_id,
                row.target_id,
                row.data,
                row.timestamp,
                discordClient,
            ).catch((alertError) => {
                logger.error('Failed to dispatch alert after batch log insert:', alertError);
            });
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
        // 표준 Error 객체인 경우 메시지, 스택, 코드(pg 오류 코드) 로깅
        logger.error(errorMessage, {
            type: 'Standard Error',
            message: error.message,
            stack: error.stack,
            code: pgErr.code, // pg 에러 코드 확인
            detail: pgErr.detail, // pg 상세 메시지 확인
        });
    } else {
        // 표준 Error 객체가 아닌 경우, 객체 타입과 내용을 최대한 로깅
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

// Function to fetch logs with pagination
// ... (fetchLogs 구현은 동일하게 유지)

/**
 * Fetches logs from the database with pagination.
 * @param guildId The ID of the guild to fetch logs for.
 * @param page The page number to fetch (1-indexed).
 * @param limit The number of logs per page.
 * @param filters Optional filters (eventType, userId, channelId, targetId).
 * @returns Promise with logs, totalPages, totalLogs
 */
export async function fetchLogs(
    guildId: string,
    page = 1,
    limit = 10,
    filters: { eventType?: string; userId?: string; channelId?: string; targetId?: string } = {},
): Promise<{ logs: FetchedLogRow[]; totalPages: number; totalLogs: number }> {
    const offset = (page - 1) * limit;
    let query = `SELECT id, event_type, user_id, channel_id, target_id, data, timestamp FROM event_logs WHERE guild_id = $1`;
    let countQuery = `SELECT COUNT(*) FROM event_logs WHERE guild_id = $1`;
    const queryParams: (string | number)[] = [guildId];
    const countParams: string[] = [guildId];
    let paramIndex = 2;

    // 필터 적용
    if (filters.eventType) {
        query += ` AND event_type = $${paramIndex}`;
        countQuery += ` AND event_type = $${paramIndex}`;
        queryParams.push(filters.eventType);
        countParams.push(filters.eventType);
        paramIndex++;
    }
    if (filters.userId) {
        query += ` AND user_id = $${paramIndex}`;
        countQuery += ` AND user_id = $${paramIndex}`;
        queryParams.push(filters.userId);
        countParams.push(filters.userId);
        paramIndex++;
    }
    if (filters.channelId) {
        query += ` AND channel_id = $${paramIndex}`;
        countQuery += ` AND channel_id = $${paramIndex}`;
        queryParams.push(filters.channelId);
        countParams.push(filters.channelId);
        paramIndex++;
    }
    if (filters.targetId) {
        query += ` AND target_id = $${paramIndex}`;
        countQuery += ` AND target_id = $${paramIndex}`;
        queryParams.push(filters.targetId);
        countParams.push(filters.targetId);
        paramIndex++;
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);

    try {
        const logResult = await pool.query<FetchedLogRow>(query, queryParams);
        const countResult = await pool.query<CountRow>(countQuery, countParams);
        const totalLogs = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalLogs / limit);
        // logger.debug(`Fetched logs page ${page}/${totalPages}, Count: ${logResult.rows.length}, Total: ${totalLogs}, Filters: ${JSON.stringify(filters)}`);
        return {
            logs: logResult.rows,
            totalPages: totalPages,
            totalLogs: totalLogs,
        };
    } catch (error) {
        logger.error(`Error fetching logs for guild ${guildId}, page ${page}:`, error);
        throw error; // Re-throw the error for the caller to handle
    }
}

/**
 * 필수 테이블/인덱스/확장 모듈 존재를 보장하는 스키마 마이그레이션을 수행합니다.
 */
export async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Event Logs Table
        await client.query(`
      CREATE TABLE IF NOT EXISTS event_logs (
        id SERIAL, -- 파티셔닝 사용 시 PRIMARY KEY는 파티션 키를 포함해야 함. 또는 각 파티션에서 로컬 PK를 갖도록 수정 필요. 여기서는 일단 SERIAL로 유지하고 PK 제약조건 제거. 필요 시 추후 조정.
        event_type VARCHAR(50) NOT NULL, -- 이벤트 종류 (e.g., 'messageCreate', 'guildMemberAdd')
        guild_id VARCHAR(30) NOT NULL,    -- 서버 ID (Partition Key)
        channel_id VARCHAR(30),           -- 채널 ID (Nullable)
        user_id VARCHAR(30),              -- 사용자 ID (Nullable)
        target_id VARCHAR(30),            -- 대상 ID (Nullable, e.g., banned user, deleted message)
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 이벤트 발생 시간
        data JSONB
      ) PARTITION BY LIST (guild_id); -- guild_id를 기준으로 리스트 파티셔닝 적용
    `);
        await client.query(
            `ALTER TABLE event_logs DROP CONSTRAINT IF EXISTS event_logs_unique_guild_event_target;`,
        );
        await client.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_logs_message_create_unique_target
             ON event_logs (guild_id, event_type, target_id)
             WHERE event_type = 'messageCreate';`,
        );
        // 인덱스 추가 (선택적이지만 조회 성능 향상에 도움)
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_timestamp ON event_logs (guild_id, "timestamp" DESC);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_event_type ON event_logs (guild_id, event_type);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_user_id ON event_logs (guild_id, user_id);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_target_id ON event_logs (guild_id, target_id);`,
        );

        // JSONB 검색 최적화를 위한 인덱스
        await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_content_gin ON event_logs USING GIN ((data->>'content') gin_trgm_ops);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_newcontent_gin ON event_logs USING GIN ((data->>'newContent') gin_trgm_ops);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_oldcontent_gin ON event_logs USING GIN ((data->>'oldContent') gin_trgm_ops);`,
        );

        // 다른 테이블 마이그레이션 (예: settings)
        // await client.query(`CREATE TABLE IF NOT EXISTS settings (...)`);
        await client.query(`
            CREATE TABLE IF NOT EXISTS command_permissions (
                guild_id VARCHAR(30) NOT NULL,
                command_name VARCHAR(100) NOT NULL,
                user_id VARCHAR(30) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (guild_id, command_name, user_id)
            );
        `);
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_command_permissions_guild_user ON command_permissions (guild_id, user_id);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_command_permissions_guild_command ON command_permissions (guild_id, command_name);`,
        );

        await client.query('COMMIT');
        logger.info('Database migration check completed successfully.');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Database migration failed:', error);
        throw error; // Propagate error to stop application startup if needed
    } finally {
        client.release();
    }
}

/**
 * 길드 로그 개수를 조건(eventType/userId) 기준으로 집계합니다.
 */
export async function countLogs(
    guildId: string,
    filters: { eventType?: string; userId?: string } = {},
): Promise<number> {
    let query = `SELECT COUNT(*) FROM event_logs WHERE guild_id = $1`;
    const params: string[] = [guildId];

    if (filters.eventType) {
        query += ` AND event_type = $${params.length + 1}`;
        params.push(filters.eventType);
    }
    if (filters.userId) {
        query += ` AND user_id = $${params.length + 1}`;
        params.push(filters.userId);
    }
    // Add other filters as needed

    try {
        const result = await pool.query<CountRow>(query, params);
        return parseInt(result.rows[0].count, 10);
    } catch (error) {
        logger.error(`Error counting logs for guild ${guildId}:`, error);
        return 0; // Return 0 or throw error
    }
}

/**
 * 길드 전체 로그 통계를 집계해 대시보드/리포트용 값으로 반환합니다.
 */
export async function getGuildLogStats(guildId: string): Promise<GuildLogStats> {
    const query = `
    WITH message_data AS (
      SELECT
        COALESCE(data->>'content', '') AS content,
        data->'attachments' AS attachments,
        data->'stickers' AS stickers
      FROM event_logs
      WHERE guild_id = $1 AND event_type = 'messageCreate'
    )
    SELECT
      (SELECT COUNT(*) FROM event_logs WHERE guild_id = $1) AS total_logs,
      COUNT(*) AS message_create_count,
      COALESCE(SUM(CASE WHEN content <> '' THEN 1 ELSE 0 END), 0) AS text_message_count,
      COALESCE(SUM(LENGTH(content)), 0) AS total_text_characters,
      COALESCE(SUM(COALESCE(jsonb_array_length(attachments), 0)), 0) AS attachment_count,
      COALESCE(SUM(COALESCE(jsonb_array_length(stickers), 0)), 0) AS sticker_count
    FROM message_data;
  `;

    try {
        const result = await pool.query<GuildLogStatsRow>(query, [guildId]);
        const row = result.rows[0];
        const r = row;
        return {
            totalLogs: Number(r.total_logs),
            messageCreateCount: Number(r.message_create_count),
            textMessageCount: Number(r.text_message_count),
            totalTextCharacters: Number(r.total_text_characters),
            attachmentCount: Number(r.attachment_count),
            stickerCount: Number(r.sticker_count),
        };
    } catch (error) {
        logger.error(`Error fetching guild log stats for guild ${guildId}:`, error);
        return {
            totalLogs: 0,
            messageCreateCount: 0,
            textMessageCount: 0,
            totalTextCharacters: 0,
            attachmentCount: 0,
            stickerCount: 0,
        };
    }
}

/**
 * DB count 문자열 값을 안전한 number(실패 시 0)로 변환합니다.
 */
function toCount(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 최근 24시간과 이전 24시간의 증감률(%)을 계산합니다.
 */
function computeTrendPercent(last24h: number, prev24h: number): number | null {
    if (prev24h === 0) {
        return last24h === 0 ? 0 : null;
    }
    return Math.round(((last24h - prev24h) / prev24h) * 100 * 10) / 10;
}

/**
 * where 절 기반 범용 리포트 집계를 수행합니다(길드/채널/유저 공용).
 */
async function getLogScopeReport(
    whereClause: string,
    queryParams: string[],
): Promise<LogScopeReport> {
    const summaryQuery = `
    SELECT
      COUNT(*) AS total_logs,
      COUNT(*) FILTER (WHERE event_type = 'messageCreate') AS message_create_count,
      COUNT(*) FILTER (WHERE event_type = 'messageUpdate') AS message_update_count,
      COUNT(*) FILTER (WHERE event_type = 'messageDelete') AS message_delete_count,
      COUNT(*) FILTER (WHERE event_type IN ('guildBanAdd', 'guildBanRemove', 'guildMemberRemove', 'messageDeleteBulk')) AS moderation_action_count,
      COALESCE(SUM(CASE WHEN event_type = 'messageCreate' THEN COALESCE(jsonb_array_length(data->'attachments'), 0) ELSE 0 END), 0) AS attachment_count,
      COALESCE(SUM(CASE WHEN event_type = 'messageCreate' THEN COALESCE(jsonb_array_length(data->'stickers'), 0) ELSE 0 END), 0) AS sticker_count,
      MAX("timestamp") AS last_activity_at,
      COUNT(*) FILTER (WHERE "timestamp" >= NOW() - INTERVAL '24 hours') AS last_24h_count,
      COUNT(*) FILTER (WHERE "timestamp" < NOW() - INTERVAL '24 hours' AND "timestamp" >= NOW() - INTERVAL '48 hours') AS prev_24h_count
    FROM event_logs
    WHERE ${whereClause};
  `;
    const topEventTypesQuery = `
    SELECT event_type, COUNT(*)::text AS count
    FROM event_logs
    WHERE ${whereClause}
    GROUP BY event_type
    ORDER BY COUNT(*) DESC
    LIMIT 5;
  `;
    const topChannelsQuery = `
    SELECT channel_id AS id, COUNT(*)::text AS count
    FROM event_logs
    WHERE ${whereClause} AND channel_id IS NOT NULL
    GROUP BY channel_id
    ORDER BY COUNT(*) DESC
    LIMIT 5;
  `;
    const topUsersQuery = `
    SELECT user_id AS id, COUNT(*)::text AS count
    FROM event_logs
    WHERE ${whereClause} AND user_id IS NOT NULL
    GROUP BY user_id
    ORDER BY COUNT(*) DESC
    LIMIT 5;
  `;

    try {
        const [summaryResult, topEventTypesResult, topChannelsResult, topUsersResult] =
            await Promise.all([
                pool.query<ScopeSummaryRow>(summaryQuery, queryParams),
                pool.query<RankedEventTypeRow>(topEventTypesQuery, queryParams),
                pool.query<RankedRow>(topChannelsQuery, queryParams),
                pool.query<RankedRow>(topUsersQuery, queryParams),
            ]);

        const summaryRow = summaryResult.rows[0];
        const totalLogs = toCount(summaryRow.total_logs);
        const messageCreateCount = toCount(summaryRow.message_create_count);
        const messageUpdateCount = toCount(summaryRow.message_update_count);
        const messageDeleteCount = toCount(summaryRow.message_delete_count);
        const moderationActionCount = toCount(summaryRow.moderation_action_count);
        const attachmentCount = toCount(summaryRow.attachment_count);
        const stickerCount = toCount(summaryRow.sticker_count);
        const last24hCount = toCount(summaryRow.last_24h_count);
        const prev24hCount = toCount(summaryRow.prev_24h_count);

        return {
            totalLogs,
            messageCreateCount,
            messageUpdateCount,
            messageDeleteCount,
            moderationActionCount,
            attachmentCount,
            stickerCount,
            lastActivityAt: summaryRow.last_activity_at ?? null,
            last24hCount,
            prev24hCount,
            trendPercent: computeTrendPercent(last24hCount, prev24hCount),
            topEventTypes: topEventTypesResult.rows.map((row) => ({
                eventType: row.event_type,
                count: toCount(row.count),
            })),
            topChannels: topChannelsResult.rows
                .filter((row) => row.id)
                .map((row) => ({
                    id: row.id ?? '',
                    count: toCount(row.count),
                })),
            topUsers: topUsersResult.rows
                .filter((row) => row.id)
                .map((row) => ({
                    id: row.id ?? '',
                    count: toCount(row.count),
                })),
        };
    } catch (error) {
        logger.error('Error building log scope report:', {
            message: error instanceof Error ? error.message : String(error),
            whereClause,
            queryParams,
        });
        return {
            totalLogs: 0,
            messageCreateCount: 0,
            messageUpdateCount: 0,
            messageDeleteCount: 0,
            moderationActionCount: 0,
            attachmentCount: 0,
            stickerCount: 0,
            lastActivityAt: null,
            last24hCount: 0,
            prev24hCount: 0,
            trendPercent: 0,
            topEventTypes: [],
            topChannels: [],
            topUsers: [],
        };
    }
}

/**
 * 길드 단위 로그 리포트를 생성합니다.
 */
export async function getGuildReport(guildId: string): Promise<LogScopeReport> {
    return await getLogScopeReport('guild_id = $1', [guildId]);
}

/**
 * 채널 단위 로그 리포트를 생성합니다.
 */
export async function getChannelReport(
    guildId: string,
    channelId: string,
): Promise<LogScopeReport> {
    return await getLogScopeReport('guild_id = $1 AND channel_id = $2', [guildId, channelId]);
}

/**
 * 사용자 단위 로그 리포트를 생성합니다.
 */
export async function getUserReport(guildId: string, userId: string): Promise<LogScopeReport> {
    return await getLogScopeReport('guild_id = $1 AND user_id = $2', [guildId, userId]);
}

/**
 * 애플리케이션 종료 시 DB 풀을 정상 종료합니다.
 */
export async function destroyDatabase() {
    logger.info('Disconnecting database pool...');
    await pool.end();
    logger.info('Database pool disconnected.');
}

/**
 * 시작 시 DB 연결 가능 여부를 확인합니다.
 */
export async function testDatabaseConnection() {
    try {
        const client = await pool.connect();
        logger.info('Database connection test successful.');
        client.release();
    } catch (error) {
        logger.error('Database connection test failed:', error);
        throw error; // Rethrow to potentially halt startup
    }
}

// --- Log Search Functionality ---

/**
 * 데이터베이스에서 로그를 검색합니다.
 * @param params 검색 조건
 * @returns {Promise<{logs: LogEntry[], totalCount: number}>} 검색된 로그 배열과 총 개수
 */
export async function searchLogs(
    params: SearchLogsParams,
): Promise<{ logs: LogEntry[]; totalCount: number }> {
    const {
        guildId,
        keyword,
        userId,
        channelId,
        startDate,
        endDate,
        eventType,
        limit, // 기본값 대신 필수로 받음
        offset = 0, // 기본값 0
    } = params;

    let queryText = `SELECT id, event_type, guild_id, user_id, channel_id, target_id, timestamp, data as event_data FROM event_logs WHERE guild_id = $1`;
    const queryParams: (string | number)[] = [guildId];
    let paramIndex = 2;

    let countQueryText = `SELECT COUNT(*) FROM event_logs WHERE guild_id = $1`;
    const countQueryParams: string[] = [guildId];
    let countParamIndex = 2;

    // 이벤트 유형 필터링
    if (eventType) {
        queryText += ` AND event_type = $${paramIndex}`;
        queryParams.push(eventType);
        countQueryText += ` AND event_type = $${countParamIndex}`;
        countQueryParams.push(eventType);
        paramIndex++;
        countParamIndex++;
    }

    // 사용자 ID 필터링
    if (userId) {
        queryText += ` AND user_id = $${paramIndex}`;
        queryParams.push(userId);
        countQueryText += ` AND user_id = $${countParamIndex}`;
        countQueryParams.push(userId);
        paramIndex++;
        countParamIndex++;
    }

    // 채널 ID 필터링
    if (channelId) {
        queryText += ` AND channel_id = $${paramIndex}`;
        queryParams.push(channelId);
        countQueryText += ` AND channel_id = $${countParamIndex}`;
        countQueryParams.push(channelId);
        paramIndex++;
        countParamIndex++;
    }

    // 날짜 범위 필터링
    if (startDate) {
        queryText += ` AND "timestamp" >= $${paramIndex}`;
        queryParams.push(startDate.toISOString());
        countQueryText += ` AND "timestamp" >= $${countParamIndex}`;
        countQueryParams.push(startDate.toISOString());
        paramIndex++;
        countParamIndex++;
    }
    if (endDate) {
        queryText += ` AND "timestamp" <= $${paramIndex}`;
        queryParams.push(endDate.toISOString());
        countQueryText += ` AND "timestamp" <= $${countParamIndex}`;
        countQueryParams.push(endDate.toISOString());
        paramIndex++;
    }

    // 키워드 검색 로직
    if (keyword) {
        // messageCreate 의 content, messageUpdate 의 newContent/oldContent 등 주요 텍스트 필드 대상
        const keywordCondition = `(
            (data->>'content') ILIKE $${paramIndex} OR
            (data->>'newContent') ILIKE $${paramIndex} OR
            (data->>'oldContent') ILIKE $${paramIndex}
        )`;
        const countKeywordCondition = keywordCondition;

        queryText += ` AND ${keywordCondition}`;
        queryParams.push(`%${keyword}%`);
        paramIndex++;

        countQueryText += ` AND ${countKeywordCondition}`;
        countQueryParams.push(`%${keyword}%`);
    }

    const limitParamIndex = paramIndex;
    const offsetParamIndex = paramIndex + 1;
    queryText += ` ORDER BY "timestamp" DESC LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`;
    queryParams.push(limit, offset);

    // logger.debug(`Executing searchLogs query: ${queryText} with params: ${JSON.stringify(queryParams)}`);
    // logger.debug(`Executing count query: ${countQueryText} with params: ${JSON.stringify(countQueryParams)}`);

    try {
        const logResult = await pool.query<LogEntry>(queryText, queryParams);
        const countResult = await pool.query<CountRow>(countQueryText, countQueryParams);

        const totalCount = parseInt(countResult.rows[0].count, 10);
        // logger.debug(`Search results count: ${logResult.rows.length}, Total matching: ${totalCount}`);

        return {
            logs: logResult.rows.map((row) => ({
                // 반환되는 로그의 event_data와 timestamp 타입 일관성 유지
                ...row,
                // event_data는 이미 JSONB에서 객체로 파싱되었거나, SELECT 시 data as event_data로 가져옴
                // timestamp도 Date 객체로 잘 변환되어 오는지 확인 필요 (pg 드라이버 설정에 따라 다를 수 있음)
                // 명시적으로 new Date() 처리는 일단 보류 (기존 코드와 동일하게 유지)
            })),
            totalCount: totalCount,
        };
    } catch (error) {
        logger.error('Error searching logs:', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            queryText,
            queryParams,
            countQueryText,
            countQueryParams,
        });
        return { logs: [], totalCount: 0 }; // 오류 발생 시 빈 결과 반환
    }
}

// --- End of Log Search Functionality ---

/**
 * 전역 PostgreSQL 커넥션 풀 export 입니다.
 */
export { pool };

import pkg from 'pg';
const { Pool } = pkg;
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';
import { config } from '../config/config.js';
import { sanitizeObjectStrings } from '../utils/sanitize.js';
import discordClient from '../utils/discordClient.js';
import { dispatchAlert } from '../utils/alertManager.js';

dotenv.config();

// PostgreSQL error type for pg library errors with code/detail
interface PgError extends Error {
    code?: string;
    detail?: string;
}

const pool = new Pool({
    user: config.dbUser,
    password: config.dbPassword,
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false, // 필요시 SSL 설정 추가
    ssl: false, // 로컬 개발용 임시
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

export async function loadAuthorizedGuildIds(): Promise<void> {
    try {
        const res = await pool.query('SELECT guild_id FROM authorized_guilds');
        authorizedGuildIds = new Set(res.rows.map((r: { guild_id: string }) => r.guild_id));
        logger.info(`Loaded ${authorizedGuildIds.size} authorized guild IDs.`);
    } catch (error) {
        logger.error('Failed to load authorized guild IDs:', error);
    }
}

export function isGuildAuthorized(guildId: string): boolean {
    return authorizedGuildIds.has(guildId);
}

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

export async function unauthorizeGuildId(guildId: string): Promise<void> {
    try {
        await pool.query('DELETE FROM authorized_guilds WHERE guild_id = $1', [guildId]);
        authorizedGuildIds.delete(guildId);
    } catch (error) {
        logger.error(`Failed to unauthorize guild ${guildId}:`, error);
    }
}

// --- Alert Subscriptions ---
export interface AlertSubscriptionRow {
    guild_id: string;
    channel_id: string;
    category: string;
}

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

export interface LogEventRecord {
    eventType: string;
    guildId: string;
    userId: string | null;
    channelId: string | null;
    targetId: string;
    data: Record<string, unknown>;
    timestamp: Date;
}

type LogEventDispatcher = (event: LogEventRecord) => Promise<boolean>;

let logEventDispatcher: LogEventDispatcher | null = null;

export function setLogEventDispatcher(dispatcher: LogEventDispatcher | null): void {
    logEventDispatcher = dispatcher;
}

function createSyntheticTargetId(
    eventType: string,
    guildId: string,
    userId: string | null,
    channelId: string | null,
    timestamp: Date,
): string {
    const stamp = timestamp.getTime().toString(36);
    const uid = userId ?? 'system';
    const cid = channelId ?? 'none';
    return `auto_${eventType}_${guildId}_${cid}_${uid}_${stamp}_${randomUUID().slice(0, 8)}`;
}

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
        targetId:
            targetId ?? createSyntheticTargetId(eventType, guildId, userId, channelId, timestamp),
        data,
        timestamp,
    };
}

async function ensureGuildPartition(guildId: string): Promise<void> {
    const partitionTableName = `event_logs_guild_${guildId}`;
    try {
        const createPartitionQuery = `CREATE TABLE IF NOT EXISTS "${partitionTableName}" PARTITION OF event_logs FOR VALUES IN ('${guildId}');`;
        await pool.query(createPartitionQuery);
    } catch (error: unknown) {
        const pgErr = error as PgError;
        if (pgErr.code === '42P07') {
            const attachQuery = `ALTER TABLE event_logs ATTACH PARTITION "${partitionTableName}" FOR VALUES IN ('${guildId}');`;
            await pool.query(attachQuery);
        } else if (pgErr.code !== '42710' && pgErr.code !== '42809') {
            throw error;
        }
    }
}

async function insertLogEventDirect(event: LogEventRecord, isRetry = false): Promise<boolean> {
    const insertQuery = `
    INSERT INTO event_logs (event_type, guild_id, user_id, channel_id, target_id, data, "timestamp")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (guild_id, event_type, target_id) DO NOTHING
    RETURNING id;
  `;
    const sanitizedData = sanitizeObjectStrings(event.data);
    const values = [
        event.eventType,
        event.guildId,
        event.userId,
        event.channelId,
        event.targetId,
        sanitizedData,
        event.timestamp,
    ];

    try {
        const result = await pool.query(insertQuery, values);
        const inserted = (result.rowCount ?? 0) > 0;
        if (inserted) {
            void dispatchAlert(
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

export async function insertLogEventDirectNow(event: LogEventRecord): Promise<boolean> {
    return await insertLogEventDirect(event);
}

export async function insertLogEventsBatch(events: LogEventRecord[]): Promise<number> {
    if (events.length === 0) {
        return 0;
    }

    const uniqueGuildIds = [...new Set(events.map((event) => event.guildId))];
    await Promise.all(uniqueGuildIds.map((guildId) => ensureGuildPartition(guildId)));

    const values: unknown[] = [];
    const rows = events.map((event, index) => {
        const base = index * 7;
        values.push(
            event.eventType,
            event.guildId,
            event.userId,
            event.channelId,
            event.targetId,
            sanitizeObjectStrings(event.data),
            event.timestamp,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    const insertQuery = `
      INSERT INTO event_logs (event_type, guild_id, user_id, channel_id, target_id, data, "timestamp")
      VALUES ${rows.join(', ')}
      ON CONFLICT (guild_id, event_type, target_id) DO NOTHING
      RETURNING event_type, guild_id, user_id, channel_id, target_id, data, "timestamp"
    `;

    try {
        const result = await pool.query<{
            event_type: string;
            guild_id: string;
            user_id: string | null;
            channel_id: string | null;
            target_id: string;
            data: Record<string, unknown>;
            timestamp: Date;
        }>(insertQuery, values);

        for (const row of result.rows) {
            void dispatchAlert(
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

        return result.rowCount ?? 0;
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

// Helper function to avoid duplicating the original error logging logic
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

interface FetchedLogRow {
    id: number;
    event_type: string;
    user_id: string | null;
    channel_id: string | null;
    target_id: string | null;
    data: Record<string, unknown>;
    timestamp: Date;
}

interface CountRow {
    count: string;
}

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

// Function to migrate database schema
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
        data JSONB,
        -- UNIQUE 제약 조건 추가: guild_id, event_type, target_id 조합은 고유해야 함
        CONSTRAINT event_logs_unique_guild_event_target UNIQUE (guild_id, event_type, target_id)
      ) PARTITION BY LIST (guild_id); -- guild_id를 기준으로 리스트 파티셔닝 적용
    `);
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

// Function to count logs (optional, can be derived from fetchLogs total)
export async function countLogs(
    guildId: string,
    filters: { eventType?: string; userId?: string } = {},
): Promise<number> {
    let query = `SELECT COUNT(*) FROM event_logs WHERE guild_id = $1`;
    const params: string[] = [guildId];
    let paramIndex = 2;

    if (filters.eventType) {
        query += ` AND event_type = $${paramIndex++}`;
        params.push(filters.eventType);
    }
    if (filters.userId) {
        query += ` AND user_id = $${paramIndex++}`;
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

export interface GuildLogStats {
    totalLogs: number;
    messageCreateCount: number;
    textMessageCount: number;
    totalTextCharacters: number;
    attachmentCount: number;
    stickerCount: number;
}

interface GuildLogStatsRow {
    total_logs: string;
    message_create_count: string;
    text_message_count: string;
    total_text_characters: string;
    attachment_count: string;
    sticker_count: string;
}

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
        const empty: GuildLogStatsRow = {
            total_logs: '0',
            message_create_count: '0',
            text_message_count: '0',
            total_text_characters: '0',
            attachment_count: '0',
            sticker_count: '0',
        };
        const r = row ?? empty;
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

// Graceful shutdown
export async function destroyDatabase() {
    logger.info('Disconnecting database pool...');
    await pool.end();
    logger.info('Database pool disconnected.');
}

// Application startup check
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
 * 검색 조건 인터페이스
 */
export interface SearchLogsParams {
    guildId: string;
    keyword?: string;
    userId?: string;
    channelId?: string;
    startDate?: Date;
    endDate?: Date;
    eventType?: string;
    limit: number; // 페이지당 로그 수 (필수)
    offset?: number; // 가져올 로그의 시작 위치 (페이지네이션용)
}

/**
 * 로그 항목 인터페이스 (searchLogs 반환 타입)
 */
export interface LogEntry {
    id: number;
    event_type: string;
    guild_id: string;
    user_id: string | null;
    channel_id: string | null;
    target_id: string | null;
    timestamp: Date;
    event_data: Record<string, unknown>; // data 컬럼의 JSONB 내용을 파싱한 객체
}

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
        countParamIndex++;
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
        countParamIndex++;
    }

    queryText += ` ORDER BY "timestamp" DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
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

export default pool;

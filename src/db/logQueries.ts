import { pool } from './database.js';
import { logger } from '../utils/logger.js';

import type { GuildLogStats } from '../types/database.js';
import type {
    CountRow,
    FetchedLogRow,
    GuildLogStatsRow,
    RankedEventTypeRow,
    RankedRow,
    ScopeSummaryRow,
} from '../types/dbRows.js';
import type { LogEntry, LogScopeReport, SearchLogsParams } from '../types/logs.js';

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
        return {
            logs: logResult.rows,
            totalPages,
            totalLogs,
        };
    } catch (error) {
        logger.error(`Error fetching logs for guild ${guildId}, page ${page}:`, error);
        throw error;
    }
}

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

    try {
        const result = await pool.query<CountRow>(query, params);
        return parseInt(result.rows[0].count, 10);
    } catch (error) {
        logger.error(`Error counting logs for guild ${guildId}:`, error);
        return 0;
    }
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
        return {
            totalLogs: Number(row.total_logs),
            messageCreateCount: Number(row.message_create_count),
            textMessageCount: Number(row.text_message_count),
            totalTextCharacters: Number(row.total_text_characters),
            attachmentCount: Number(row.attachment_count),
            stickerCount: Number(row.sticker_count),
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

function toCount(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function computeTrendPercent(last24h: number, prev24h: number): number | null {
    if (prev24h === 0) {
        return last24h === 0 ? 0 : null;
    }
    return Math.round(((last24h - prev24h) / prev24h) * 100 * 10) / 10;
}

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

export async function getGuildReport(guildId: string): Promise<LogScopeReport> {
    return await getLogScopeReport('guild_id = $1', [guildId]);
}

export async function getChannelReport(
    guildId: string,
    channelId: string,
): Promise<LogScopeReport> {
    return await getLogScopeReport('guild_id = $1 AND channel_id = $2', [guildId, channelId]);
}

export async function getUserReport(guildId: string, userId: string): Promise<LogScopeReport> {
    return await getLogScopeReport('guild_id = $1 AND user_id = $2', [guildId, userId]);
}

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
        limit,
        offset = 0,
    } = params;

    let queryText = `SELECT id, event_type, guild_id, user_id, channel_id, target_id, timestamp, data as event_data FROM event_logs WHERE guild_id = $1`;
    const queryParams: (string | number)[] = [guildId];
    let paramIndex = 2;

    let countQueryText = `SELECT COUNT(*) FROM event_logs WHERE guild_id = $1`;
    const countQueryParams: string[] = [guildId];
    let countParamIndex = 2;

    if (eventType) {
        queryText += ` AND event_type = $${paramIndex}`;
        queryParams.push(eventType);
        countQueryText += ` AND event_type = $${countParamIndex}`;
        countQueryParams.push(eventType);
        paramIndex++;
        countParamIndex++;
    }
    if (userId) {
        queryText += ` AND user_id = $${paramIndex}`;
        queryParams.push(userId);
        countQueryText += ` AND user_id = $${countParamIndex}`;
        countQueryParams.push(userId);
        paramIndex++;
        countParamIndex++;
    }
    if (channelId) {
        queryText += ` AND channel_id = $${paramIndex}`;
        queryParams.push(channelId);
        countQueryText += ` AND channel_id = $${countParamIndex}`;
        countQueryParams.push(channelId);
        paramIndex++;
        countParamIndex++;
    }
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

    if (keyword) {
        const keywordCondition = `(
            (data->>'content') ILIKE $${paramIndex} OR
            (data->>'newContent') ILIKE $${paramIndex} OR
            (data->>'oldContent') ILIKE $${paramIndex}
        )`;
        const countKeywordCondition = `(
            (data->>'content') ILIKE $${countParamIndex} OR
            (data->>'newContent') ILIKE $${countParamIndex} OR
            (data->>'oldContent') ILIKE $${countParamIndex}
        )`;

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

    try {
        const logResult = await pool.query<LogEntry>(queryText, queryParams);
        const countResult = await pool.query<CountRow>(countQueryText, countQueryParams);
        const totalCount = parseInt(countResult.rows[0].count, 10);
        return {
            logs: logResult.rows.map((row) => ({ ...row })),
            totalCount,
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
        return { logs: [], totalCount: 0 };
    }
}

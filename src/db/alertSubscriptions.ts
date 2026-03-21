import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

import type { AlertSubscriptionRow } from '../types/alerts.js';
import type { LatestMessageCreateCheckpointRow } from '../types/dbRows.js';

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

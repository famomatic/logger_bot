import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

export interface CommandPermissionRow {
    guildId: string;
    commandName: string;
    userId: string;
}

let authorizedGuildIds = new Set<string>();
let authorizedGuildCacheReady = false;

/**
 * `authorized_guilds` 테이블을 읽어 메모리 캐시를 초기화합니다.
 */
export async function loadAuthorizedGuildIds(): Promise<void> {
    try {
        const res = await pool.query('SELECT guild_id FROM authorized_guilds');
        authorizedGuildIds = new Set(res.rows.map((r: { guild_id: string }) => r.guild_id));
        authorizedGuildCacheReady = true;
        logger.info(`Loaded ${authorizedGuildIds.size} authorized guild IDs.`);
    } catch (error) {
        authorizedGuildCacheReady = false;
        logger.error('Failed to load authorized guild IDs:', error);
        throw error;
    }
}

/**
 * 메모리 기반 authorized guild 캐시가 성공적으로 적재되었는지 반환합니다.
 */
export function isAuthorizedGuildCacheReady(): boolean {
    return authorizedGuildCacheReady;
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

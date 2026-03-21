import { logger } from './logger.js';

import type { AuditLogEvent, Guild, GuildAuditLogs } from 'discord.js';

interface FetchAuditLogsCachedOptions<T extends AuditLogEvent = AuditLogEvent> {
    type: T;
    limit?: number;
    ttlMs?: number;
}

interface CachedAuditLogsEntry {
    expiresAt: number;
    logs: GuildAuditLogs<AuditLogEvent>;
}

const cache = new Map<string, CachedAuditLogsEntry>();
const inFlight = new Map<string, Promise<GuildAuditLogs<AuditLogEvent>>>();

function buildCacheKey<T extends AuditLogEvent>(
    guildId: string,
    options: FetchAuditLogsCachedOptions<T>,
): string {
    const typeKey = String(options.type);
    const limitKey = String(options.limit ?? 50);
    return `${guildId}:${typeKey}:${limitKey}`;
}

/**
 * 짧은 TTL 캐시를 사용해 동일 길드/타입 Audit Log 조회 폭주를 완화합니다.
 */
export async function fetchAuditLogsCached(
    guild: Guild,
    options: FetchAuditLogsCachedOptions,
): Promise<GuildAuditLogs<AuditLogEvent>>;
export async function fetchAuditLogsCached<T extends AuditLogEvent>(
    guild: Guild,
    options: FetchAuditLogsCachedOptions<T>,
): Promise<GuildAuditLogs<T>>;
export async function fetchAuditLogsCached<T extends AuditLogEvent>(
    guild: Guild,
    options: FetchAuditLogsCachedOptions<T>,
): Promise<GuildAuditLogs<T>> {
    const ttlMs = options.ttlMs ?? 2_000;
    const key = buildCacheKey(guild.id, options);
    const now = Date.now();
    const cached = cache.get(key);

    if (cached && cached.expiresAt > now) {
        return cached.logs as GuildAuditLogs<T>;
    }

    const existingInFlight = inFlight.get(key);
    if (existingInFlight) {
        return (await existingInFlight) as GuildAuditLogs<T>;
    }

    const request = (async () => {
        try {
            const logs = (await guild.fetchAuditLogs({
                limit: options.limit ?? 50,
                type: options.type,
            })) as GuildAuditLogs<AuditLogEvent>;
            cache.set(key, {
                expiresAt: Date.now() + ttlMs,
                logs,
            });
            return logs;
        } catch (error) {
            if (cached) {
                logger.warn(
                    `Audit log fetch failed for guild=${guild.id}. Using stale cache key=${key}.`,
                    error,
                );
                return cached.logs;
            }
            throw error;
        } finally {
            inFlight.delete(key);
        }
    })();

    inFlight.set(key, request);
    return (await request) as GuildAuditLogs<T>;
}

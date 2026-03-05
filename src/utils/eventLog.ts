import { isGuildAuthorized, logEvent as writeLogEvent } from '../db/database.js';
import { logger } from './logger.js';

export function shouldLogForGuild(
    guildId: string | null | undefined,
    eventType?: string,
): guildId is string {
    if (!guildId) {
        return false;
    }
    if (!isGuildAuthorized(guildId)) {
        if (eventType) {
            logger.warn(`Skipping ${eventType} log for unauthorized guild ${guildId}`);
        } else {
            logger.warn(`Skipping log for unauthorized guild ${guildId}`);
        }
        return false;
    }
    return true;
}

export async function logEventIfAuthorized(
    eventType: string,
    guildId: string | null | undefined,
    userId: string | null,
    channelId: string | null,
    targetId: string | null,
    data: Record<string, unknown>,
    timestamp: Date,
): Promise<boolean> {
    if (!shouldLogForGuild(guildId, eventType)) {
        return false;
    }

    try {
        return await writeLogEvent(
            eventType,
            guildId,
            userId,
            channelId,
            targetId,
            data,
            timestamp,
        );
    } catch (error) {
        logger.error(
            `Error logging ${eventType} for target ${targetId ?? 'N/A'} in guild ${guildId ?? 'unknown'}:`,
            error,
        );
        return false;
    }
}

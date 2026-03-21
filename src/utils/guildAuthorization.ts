import { AuditLogEvent, DiscordAPIError } from 'discord.js';

import { logger } from './logger.js';
import { isAuthorizedGuildCacheReady, isGuildAuthorized } from '../db/database.js';

import type { Client, Guild } from 'discord.js';

/**
 * 인증되지 않은 길드에 안내 메시지를 남긴 뒤 봇을 탈퇴시킵니다.
 */
export async function leaveUnauthorizedGuild(guild: Guild): Promise<void> {
    const guildId = guild.id;
    logger.warn(`Unauthorized guild detected ${guild.name} (${guildId})`);
    let inviter = null;
    try {
        const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
        const entry = logs.entries.find((e) => e.target?.id === guild.client.user.id);
        inviter = entry?.executor ?? null;
    } catch (err) {
        logger.error('Failed to fetch BotAdd audit log:', err);
    }
    try {
        const user = inviter ?? (await guild.fetchOwner()).user;
        await user.send(
            `해당 길드 (${guild.name})는 승인되지 않았습니다. 봇이 이 길드를 나갑니다.`,
        );
    } catch (err) {
        if (err instanceof DiscordAPIError && err.code === 50007) {
            logger.warn('Cannot send unauthorized guild DM: DM disabled or bot blocked.');
        } else {
            logger.error('Failed to send unauthorized guild DM:', err);
        }
    }
    try {
        await guild.leave();
        logger.info(`Left unauthorized guild ${guild.name} (${guildId})`);
    } catch (err) {
        logger.error('Failed to leave unauthorized guild:', err);
    }
}

/**
 * 현재 접속한 길드 중 미인증 길드를 순회하며 자동 탈퇴 처리합니다.
 */
export async function checkAndLeaveUnauthorizedGuilds(client: Client): Promise<void> {
    if (!isAuthorizedGuildCacheReady()) {
        logger.error(
            'Authorized guild cache is not ready. Skipping unauthorized guild enforcement.',
        );
        return;
    }

    for (const guild of client.guilds.cache.values()) {
        if (!isGuildAuthorized(guild.id)) {
            await leaveUnauthorizedGuild(guild);
        }
    }
}

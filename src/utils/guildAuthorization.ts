import { Client, Guild, AuditLogEvent, DiscordAPIError } from 'discord.js';
import { isGuildAuthorized } from '../db/database.js';
import { logger } from './logger.js';

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

export async function checkAndLeaveUnauthorizedGuilds(client: Client): Promise<void> {
    for (const guild of client.guilds.cache.values()) {
        if (!isGuildAuthorized(guild.id)) {
            await leaveUnauthorizedGuild(guild);
        }
    }
}

import { isLegacyCommandByDev, processMessageCreateLog } from './logGuildMessagesService.js';
import { config } from '../config/config.js';
import { fetchLatestMessageCreateTargetIdsByChannel, isGuildAuthorized } from '../db/database.js';
import { mapWithConcurrency } from '../utils/asyncControl.js';
import { logger } from '../utils/logger.js';

import type { ErrorWithCode } from '../types/errors.js';
import type { Client, Collection, Guild, GuildTextBasedChannel, Message } from 'discord.js';

interface RecoverySummary {
    guildsProcessed: number;
    channelsProcessed: number;
    messagesChecked: number;
    messagesRecovered: number;
    errors: number;
}

const RECOVERY_GUILD_CONCURRENCY = 2;
const RECOVERY_CHANNEL_CONCURRENCY = 3;

interface ChannelRecoverySummary {
    channelId: string;
    channelsProcessed: number;
    messagesChecked: number;
    messagesRecovered: number;
    errors: number;
}

/**
 * 길드별 체크포인트를 기준으로 누락 가능성이 있는 `messageCreate` 로그를 복구합니다.
 */
async function recoverGuildMessages(
    guild: Guild,
    legacyCommandPrefixes: string[],
    maxPagesPerChannel: number,
): Promise<RecoverySummary> {
    logger.info(
        `[message-recovery] Starting guild recovery guild=${guild.id} name="${guild.name}" maxPagesPerChannel=${maxPagesPerChannel}.`,
    );
    const checkpoints = await fetchLatestMessageCreateTargetIdsByChannel(guild.id);
    const channels = guild.channels.cache.filter(
        (ch): ch is GuildTextBasedChannel =>
            ch.isTextBased() &&
            !ch.isThread() &&
            ch.viewable &&
            ch.permissionsFor(guild.members.me!).has('ReadMessageHistory'),
    );
    logger.info(
        `[message-recovery] Guild ${guild.id} has ${channels.size} accessible text channels (checkpoints=${checkpoints.size}).`,
    );

    const scanSingleChannel = async (
        channel: GuildTextBasedChannel,
    ): Promise<ChannelRecoverySummary> => {
        logger.debug(
            `[message-recovery] Scanning channel guild=${guild.id} channel=${channel.id} checkpoint=${checkpoints.get(channel.id) ?? 'none'}.`,
        );
        const checkpointMessageId = checkpoints.get(channel.id);
        let before: string | undefined = undefined;
        let pages = 0;
        let reachedCheckpoint = false;
        let messagesChecked = 0;
        let messagesRecovered = 0;
        let errors = 0;

        while (!reachedCheckpoint && pages < maxPagesPerChannel) {
            try {
                const messages: Collection<string, Message> = await channel.messages.fetch({
                    limit: 100,
                    before,
                });

                if (messages.size === 0) {
                    break;
                }

                pages++;
                before = messages.lastKey() ?? undefined;

                for (const message of messages.values()) {
                    if (checkpointMessageId && message.id === checkpointMessageId) {
                        reachedCheckpoint = true;
                        break;
                    }

                    if (
                        message.author.bot ||
                        isLegacyCommandByDev(message, legacyCommandPrefixes)
                    ) {
                        continue;
                    }

                    messagesChecked++;
                    const logged = await processMessageCreateLog(guild.id, channel.id, message);
                    if (logged) {
                        messagesRecovered++;
                    }
                }

                if (messages.size < 100) {
                    break;
                }
            } catch (error) {
                const fetchError = error as ErrorWithCode;
                if (fetchError.code === 50013 || fetchError.message?.includes('Missing Access')) {
                    break;
                }
                logger.error(
                    `[message-recovery] Failed fetching channel ${channel.id} in guild ${guild.id}:`,
                    error,
                );
                errors++;
                break;
            }
        }

        return {
            channelId: channel.id,
            channelsProcessed: 1,
            messagesChecked,
            messagesRecovered,
            errors,
        };
    };

    const channelResults = await mapWithConcurrency(
        [...channels.values()],
        RECOVERY_CHANNEL_CONCURRENCY,
        async (channel) => await scanSingleChannel(channel),
    );

    const channelsProcessed = channelResults.reduce((acc, row) => acc + row.channelsProcessed, 0);
    const messagesChecked = channelResults.reduce((acc, row) => acc + row.messagesChecked, 0);
    const messagesRecovered = channelResults.reduce((acc, row) => acc + row.messagesRecovered, 0);
    const errors = channelResults.reduce((acc, row) => acc + row.errors, 0);

    return {
        guildsProcessed: 1,
        channelsProcessed,
        messagesChecked,
        messagesRecovered,
        errors,
    };
}

/**
 * 봇 시작 시 권한 있는 길드를 순회해 누락 메시지 로그를 복구하고 요약 통계를 남깁니다.
 */
export async function recoverMissedMessagesOnStartup(client: Client): Promise<void> {
    if (!config.messageRecovery.enabled) {
        logger.info('[message-recovery] Startup message recovery is disabled.');
        return;
    }

    const startedAt = Date.now();
    const legacyCommandPrefixes = client.legacyCommands
        ? Array.from(client.legacyCommands.keys())
        : [];

    const authorizedGuilds = client.guilds.cache.filter((guild) => isGuildAuthorized(guild.id));
    logger.info(
        `[message-recovery] Startup recovery started (authorizedGuilds=${authorizedGuilds.size}, maxPagesPerChannel=${config.messageRecovery.maxPagesPerChannel}).`,
    );
    if (authorizedGuilds.size === 0) {
        logger.info('[message-recovery] No authorized guilds to recover.');
    }

    let guildsProcessed = 0;
    let channelsProcessed = 0;
    let messagesChecked = 0;
    let messagesRecovered = 0;
    let errors = 0;

    const guildResults = await mapWithConcurrency(
        [...authorizedGuilds.values()],
        RECOVERY_GUILD_CONCURRENCY,
        async (guild) => {
            try {
                const result = await recoverGuildMessages(
                    guild,
                    legacyCommandPrefixes,
                    config.messageRecovery.maxPagesPerChannel,
                );
                logger.info(
                    `[message-recovery] Guild completed guild=${guild.id} channels=${result.channelsProcessed} checked=${result.messagesChecked} recovered=${result.messagesRecovered} errors=${result.errors}.`,
                );
                return result;
            } catch (error) {
                logger.error(
                    `[message-recovery] Unexpected recovery failure in guild ${guild.id}:`,
                    error,
                );
                return {
                    guildsProcessed: 0,
                    channelsProcessed: 0,
                    messagesChecked: 0,
                    messagesRecovered: 0,
                    errors: 1,
                } as RecoverySummary;
            }
        },
    );

    for (const result of guildResults) {
        guildsProcessed += result.guildsProcessed;
        channelsProcessed += result.channelsProcessed;
        messagesChecked += result.messagesChecked;
        messagesRecovered += result.messagesRecovered;
        errors += result.errors;
    }

    logger.info(
        `[message-recovery] Completed in ${((Date.now() - startedAt) / 1000).toFixed(2)}s (guilds=${guildsProcessed}, channels=${channelsProcessed}, checked=${messagesChecked}, recovered=${messagesRecovered}, errors=${errors}).`,
    );
}

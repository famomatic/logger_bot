import { Client, Collection, Guild, GuildTextBasedChannel, Message } from 'discord.js';
import { config } from '../config/config.js';
import { fetchLatestMessageCreateTargetIdsByChannel, isGuildAuthorized } from '../db/database.js';
import type { ErrorWithCode } from '../types/errors.js';
import { logger } from '../utils/logger.js';
import { isLegacyCommandByDev, processMessageCreateLog } from './logGuildMessagesService.js';

interface RecoverySummary {
    guildsProcessed: number;
    channelsProcessed: number;
    messagesChecked: number;
    messagesRecovered: number;
    errors: number;
}

async function recoverGuildMessages(
    guild: Guild,
    legacyCommandPrefixes: string[],
    maxPagesPerChannel: number,
): Promise<RecoverySummary> {
    const checkpoints = await fetchLatestMessageCreateTargetIdsByChannel(guild.id);
    const channels = guild.channels.cache.filter(
        (ch): ch is GuildTextBasedChannel =>
            ch.isTextBased() &&
            !ch.isThread() &&
            ch.viewable &&
            (ch.permissionsFor(guild.members.me!)?.has('ReadMessageHistory') ?? false),
    );

    let channelsProcessed = 0;
    let messagesChecked = 0;
    let messagesRecovered = 0;
    let errors = 0;

    for (const channel of channels.values()) {
        channelsProcessed++;
        const checkpointMessageId = checkpoints.get(channel.id);
        let before: string | undefined = undefined;
        let pages = 0;
        let reachedCheckpoint = false;

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
    }

    return {
        guildsProcessed: 1,
        channelsProcessed,
        messagesChecked,
        messagesRecovered,
        errors,
    };
}

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

    let guildsProcessed = 0;
    let channelsProcessed = 0;
    let messagesChecked = 0;
    let messagesRecovered = 0;
    let errors = 0;

    for (const guild of authorizedGuilds.values()) {
        try {
            const result = await recoverGuildMessages(
                guild,
                legacyCommandPrefixes,
                config.messageRecovery.maxPagesPerChannel,
            );
            guildsProcessed += result.guildsProcessed;
            channelsProcessed += result.channelsProcessed;
            messagesChecked += result.messagesChecked;
            messagesRecovered += result.messagesRecovered;
            errors += result.errors;
        } catch (error) {
            logger.error(
                `[message-recovery] Unexpected recovery failure in guild ${guild.id}:`,
                error,
            );
            errors++;
        }
    }

    logger.info(
        `[message-recovery] Completed in ${((Date.now() - startedAt) / 1000).toFixed(2)}s (guilds=${guildsProcessed}, channels=${channelsProcessed}, checked=${messagesChecked}, recovered=${messagesRecovered}, errors=${errors}).`,
    );
}

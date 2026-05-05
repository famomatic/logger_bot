import { mapWithConcurrency, withTimeout } from './asyncControl.js';
import { logger } from './logger.js';
import { escapeCodeBlockContent } from './sanitize.js';
import { eventConfigurations, getFriendlyEventName } from '../config/eventsConfig.js';
import {
    addAlertSubscription,
    fetchAlertSubscriptions,
    removeAlertSubscription,
} from '../db/database.js';
import { resolveLocale } from '../i18n/index.js';

import type { AlertSubscription } from '../types/alerts.js';
import type { Client, GuildTextBasedChannel } from 'discord.js';

interface AlertDispatchJob {
    eventType: string;
    guildId: string;
    userId: string | null;
    channelId: string | null;
    targetId: string | null;
    data: Record<string, unknown>;
    timestamp: Date;
    client: Client;
}

const subscriptions = new Map<string, AlertSubscription>();
const alertChannelCache = new Map<
    string,
    {
        fetchedAt: number;
        channel: GuildTextBasedChannel | null;
    }
>();

const ALERT_CHANNEL_CACHE_TTL_MS = 60_000;
const ALERT_QUEUE_MAX_SIZE = 2_000;
const ALERT_QUEUE_BATCH_SIZE = 50;
const ALERT_DISPATCH_CONCURRENCY = 4;
const ALERT_DISPATCH_TIMEOUT_MS = 3_000;
const ALERT_FLUSH_POLL_MS = 50;

const dispatchQueue: AlertDispatchJob[] = [];
let dispatchLoopRunning = false;

function subscriptionKey(guildId: string, category: string, channelId: string): string {
    return `${guildId}:${category}:${channelId}`;
}

export const categoryEventMap: Partial<Record<string, string[]>> = (() => {
    const map: Partial<Record<string, string[]>> = {};
    for (const cfg of Object.values(eventConfigurations)) {
        const eventTypes = map[cfg.category] ?? (map[cfg.category] = []);
        eventTypes.push(cfg.dbEventType);
    }
    return map;
})();

export async function loadAlertSubscriptions(): Promise<void> {
    try {
        subscriptions.clear();
        const rows = await fetchAlertSubscriptions();
        for (const row of rows) {
            const types = categoryEventMap[row.category];
            if (!types) continue;
            subscriptions.set(subscriptionKey(row.guild_id, row.category, row.channel_id), {
                guildId: row.guild_id,
                channelId: row.channel_id,
                category: row.category,
                eventTypes: types,
            });
        }
        logger.info(`Loaded ${subscriptions.size} alert subscriptions.`);
    } catch (error) {
        logger.error('Failed to load alert subscriptions:', error);
    }
}

export function addSubscription(guildId: string, category: string, channelId: string): boolean {
    const types = categoryEventMap[category];
    if (!types) return false;

    const key = subscriptionKey(guildId, category, channelId);
    if (subscriptions.has(key)) {
        return true;
    }

    subscriptions.set(key, { guildId, channelId, category, eventTypes: types });
    addAlertSubscription(guildId, category, channelId).catch((error) => {
        logger.error('Failed to persist alert subscription:', error);
    });
    return true;
}

export function removeSubscription(guildId: string, category: string, channelId: string): boolean {
    const key = subscriptionKey(guildId, category, channelId);
    if (!subscriptions.has(key)) {
        return false;
    }

    subscriptions.delete(key);
    removeAlertSubscription(guildId, category, channelId).catch((error) => {
        logger.error('Failed to remove alert subscription:', error);
    });
    return true;
}

function enqueueDispatchJob(job: AlertDispatchJob): boolean {
    if (dispatchQueue.length >= ALERT_QUEUE_MAX_SIZE) {
        logger.warn(
            `Dropping alert dispatch job because queue is full (max=${ALERT_QUEUE_MAX_SIZE}).`,
        );
        return false;
    }

    dispatchQueue.push(job);
    runDispatchLoop().catch((error) => {
        logger.error('Alert dispatch loop failed to start:', error);
    });
    return true;
}

async function runDispatchLoop(): Promise<void> {
    if (dispatchLoopRunning) {
        return;
    }
    dispatchLoopRunning = true;

    try {
        while (dispatchQueue.length > 0) {
            const jobs = dispatchQueue.splice(0, ALERT_QUEUE_BATCH_SIZE);
            await mapWithConcurrency(jobs, ALERT_DISPATCH_CONCURRENCY, async (job) => {
                await dispatchAlertNow(job);
            });
        }
    } finally {
        dispatchLoopRunning = false;
        if (dispatchQueue.length > 0) {
            runDispatchLoop().catch((error) => {
                logger.error('Alert dispatch loop restart failed:', error);
            });
        }
    }
}

async function resolveTextChannel(
    client: Client,
    channelId: string,
): Promise<GuildTextBasedChannel | null> {
    const now = Date.now();
    const cached = alertChannelCache.get(channelId);
    if (cached && now - cached.fetchedAt < ALERT_CHANNEL_CACHE_TTL_MS) {
        return cached.channel;
    }

    const fromCache = client.channels.cache.get(channelId);
    let channel: GuildTextBasedChannel | null;
    if (fromCache?.isTextBased()) {
        channel = fromCache as GuildTextBasedChannel;
    } else {
        const fetched = await client.channels.fetch(channelId).catch(() => null);
        channel = fetched?.isTextBased() ? (fetched as GuildTextBasedChannel) : null;
    }

    alertChannelCache.set(channelId, {
        fetchedAt: now,
        channel,
    });
    return channel;
}

async function dispatchAlertNow(job: AlertDispatchJob): Promise<void> {
    const { eventType, guildId, userId, channelId, targetId, data, timestamp, client } = job;

    const targets = Array.from(subscriptions.values()).filter(
        (sub) => sub.guildId === guildId && sub.eventTypes.includes(eventType),
    );
    if (targets.length === 0) {
        return;
    }

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    const locale = resolveLocale(guild?.preferredLocale);
    const friendlyName = getFriendlyEventName(eventType, locale);
    const json = escapeCodeBlockContent(JSON.stringify(data).slice(0, 1800));
    const summaryLines = [
        locale === 'ko'
            ? `이벤트: ${friendlyName} (${eventType})`
            : `Event: ${friendlyName} (${eventType})`,
        locale === 'ko'
            ? `타임스탬프: <t:${Math.floor(timestamp.getTime() / 1000)}:F>`
            : `Timestamp: <t:${Math.floor(timestamp.getTime() / 1000)}:F>`,
        locale === 'ko'
            ? `채널: ${channelId ? `<#${channelId}> (${channelId})` : 'N/A'}`
            : `Channel: ${channelId ? `<#${channelId}> (${channelId})` : 'N/A'}`,
        locale === 'ko' ? `대상 ID: ${targetId ?? 'N/A'}` : `Target ID: ${targetId ?? 'N/A'}`,
        locale === 'ko' ? `사용자 ID: ${userId ?? 'N/A'}` : `User ID: ${userId ?? 'N/A'}`,
    ];
    const content = `${summaryLines.join('\n')}\n\n${locale === 'ko' ? '데이터' : 'Data'}:\n\`\`\`json\n${json}\n\`\`\``;

    await mapWithConcurrency(targets, ALERT_DISPATCH_CONCURRENCY, async (sub) => {
        try {
            const textChannel = await withTimeout(
                resolveTextChannel(client, sub.channelId),
                ALERT_DISPATCH_TIMEOUT_MS,
                `Alert channel fetch timeout: ${sub.channelId}`,
            );
            if (!textChannel || typeof textChannel.send !== 'function') {
                return;
            }

            await withTimeout(
                Promise.resolve(
                    textChannel.send({
                        content,
                        allowedMentions: { parse: [] },
                    }),
                ).then(() => undefined),
                ALERT_DISPATCH_TIMEOUT_MS,
                `Alert send timeout: ${sub.channelId}`,
            );
        } catch (error) {
            logger.error('Failed to dispatch log alert:', error);
        }
    });
}

export function queueAlertDispatch(
    eventType: string,
    guildId: string,
    userId: string | null,
    channelId: string | null,
    targetId: string | null,
    data: Record<string, unknown>,
    timestamp: Date,
    client: Client,
): void {
    const hasMatching = Array.from(subscriptions.values()).some(
        (sub) => sub.guildId === guildId && sub.eventTypes.includes(eventType),
    );
    if (!hasMatching) {
        return;
    }

    enqueueDispatchJob({
        eventType,
        guildId,
        userId,
        channelId,
        targetId,
        data,
        timestamp,
        client,
    });
}

export async function flushAlertDispatchQueue(timeoutMs = 5_000): Promise<void> {
    const startedAt = Date.now();
    while (dispatchLoopRunning || dispatchQueue.length > 0) {
        if (Date.now() - startedAt > timeoutMs) {
            logger.warn(
                `Timed out while flushing alert dispatch queue (remaining=${dispatchQueue.length}).`,
            );
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, ALERT_FLUSH_POLL_MS));
    }
}

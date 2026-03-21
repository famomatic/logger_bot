import { mapWithConcurrency, withTimeout } from './asyncControl.js';
import { logger } from './logger.js';
import { escapeCodeBlockContent } from './sanitize.js';
import { eventConfigurations, getFriendlyEventName } from '../config/eventsConfig.js';
import {
    addAlertSubscription,
    removeAlertSubscription,
    fetchAlertSubscriptions,
} from '../db/database.js';
import { resolveLocale } from '../i18n/index.js';
import type { GuildTextBasedChannel } from 'discord.js';

import type { AlertSubscription } from '../types/alerts.js';
import type { Client } from 'discord.js';

const subscriptions = new Map<string, AlertSubscription>();
const alertChannelCache = new Map<
    string,
    {
        fetchedAt: number;
        channel: GuildTextBasedChannel | null;
    }
>();
const ALERT_CHANNEL_CACHE_TTL_MS = 60_000;

function subscriptionKey(guildId: string, category: string, channelId: string): string {
    return `${guildId}:${category}:${channelId}`;
}

/**
 * 이벤트 카테고리별 DB 이벤트 타입 목록 매핑입니다.
 */
export const categoryEventMap: Partial<Record<string, string[]>> = (() => {
    const map: Partial<Record<string, string[]>> = {};
    for (const cfg of Object.values(eventConfigurations)) {
        const eventTypes = map[cfg.category] ?? (map[cfg.category] = []);
        eventTypes.push(cfg.dbEventType);
    }
    return map;
})();

/**
 * DB에 저장된 알림 구독 설정을 메모리 구독 목록으로 로드합니다.
 */
export async function loadAlertSubscriptions(): Promise<void> {
    try {
        subscriptions.clear();
        const rows = await fetchAlertSubscriptions();
        for (const row of rows) {
            const types = categoryEventMap[row.category];
            if (!types) continue;
            const key = subscriptionKey(row.guild_id, row.category, row.channel_id);
            subscriptions.set(key, {
                guildId: row.guild_id,
                channelId: row.channel_id,
                category: row.category,
                eventTypes: types,
            });
        }
        logger.info(`Loaded ${subscriptions.size} alert subscriptions.`);
    } catch (err) {
        logger.error('Failed to load alert subscriptions:', err);
    }
}

/**
 * 길드/카테고리/채널 기준 알림 구독을 추가하고 DB에 반영합니다.
 */
export function addSubscription(guildId: string, category: string, channelId: string): boolean {
    const types = categoryEventMap[category];
    if (!types) return false;
    const key = subscriptionKey(guildId, category, channelId);
    if (subscriptions.has(key)) {
        return true;
    }
    subscriptions.set(key, { guildId, channelId, category, eventTypes: types });
    addAlertSubscription(guildId, category, channelId).catch((err) => {
        logger.error('Failed to persist alert subscription:', err);
    });
    return true;
}

/**
 * 길드/카테고리/채널 기준 알림 구독을 제거하고 DB에 반영합니다.
 */
export function removeSubscription(guildId: string, category: string, channelId: string): boolean {
    const key = subscriptionKey(guildId, category, channelId);
    if (!subscriptions.has(key)) return false;
    subscriptions.delete(key);
    removeAlertSubscription(guildId, category, channelId).catch((err) => {
        logger.error('Failed to remove alert subscription:', err);
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

async function dispatchAlertNow(job: AlertDispatchJob): Promise<void> {
    const { eventType, guildId, userId, channelId, targetId, data, timestamp, client } = job;

    const targets = [...subscriptions.values()].filter(
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
            const fetched = await withTimeout(
                client.channels.fetch(sub.channelId),
                ALERT_DISPATCH_TIMEOUT_MS,
                `Alert channel fetch timeout: ${sub.channelId}`,
            ).catch(() => null);
            if (!fetched?.isTextBased()) return;

            if ('send' in fetched && typeof fetched.send === 'function') {
                await withTimeout(
                    Promise.resolve(
                        fetched.send({
                            content,
                            allowedMentions: { parse: [] },
                        }),
                    ).then(() => undefined),
                    ALERT_DISPATCH_TIMEOUT_MS,
                    `Alert send timeout: ${sub.channelId}`,
                );
            }
        } catch (err) {
            logger.error('Failed to dispatch log alert:', err);
        }
    });
}

/**
 * 이벤트 타입에 맞는 구독 채널로 로그 알림 전송 작업을 큐에 적재합니다.
 */
export function queueAlertDispatch(
    eventType: string,
    guildId: string,
    userId: string | null,
    channelId: string | null,
    targetId: string | null,
    data: Record<string, unknown>,
    timestamp: Date,
    client: Client,
) {
    const matchingSubscriptions = Array.from(subscriptions.values()).filter(
        (sub) => sub.guildId === guildId && sub.eventTypes.includes(eventType),
    );
    if (matchingSubscriptions.length === 0) {
        return;
    }

    const guild = client.guilds.cache.get(guildId);
    const locale = resolveLocale(guild?.preferredLocale);

    for (const sub of matchingSubscriptions) {
        try {
            const now = Date.now();
            const cached = alertChannelCache.get(sub.channelId);
            const cacheFresh = cached && now - cached.fetchedAt < ALERT_CHANNEL_CACHE_TTL_MS;
            let fetched = cacheFresh ? cached.channel : null;

            if (!fetched) {
                const fromCache = client.channels.cache.get(sub.channelId);
                if (fromCache?.isTextBased()) {
                    fetched = fromCache as GuildTextBasedChannel;
                } else {
                    const lookedUp = await client.channels.fetch(sub.channelId).catch(() => null);
                    fetched = lookedUp?.isTextBased()
                        ? (lookedUp as GuildTextBasedChannel)
                        : null;
                }

                alertChannelCache.set(sub.channelId, {
                    fetchedAt: now,
                    channel: fetched,
                });
            }

            if (!fetched?.isTextBased()) continue;
            const json = escapeCodeBlockContent(JSON.stringify(data).slice(0, 1800));
            const friendlyName = getFriendlyEventName(eventType, locale);
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
                locale === 'ko'
                    ? `대상 ID: ${targetId ?? 'N/A'}`
                    : `Target ID: ${targetId ?? 'N/A'}`,
                locale === 'ko' ? `사용자 ID: ${userId ?? 'N/A'}` : `User ID: ${userId ?? 'N/A'}`,
            ];
            const content = `${summaryLines.join('\n')}\n\n${locale === 'ko' ? '데이터' : 'Data'}:\n\`\`\`json\n${json}\n\`\`\``;

/**
 * 종료 시 큐에 남은 알림 전송 작업의 drain 완료를 대기합니다.
 */
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

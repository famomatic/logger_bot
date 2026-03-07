import { logger } from './logger.js';
import { escapeCodeBlockContent } from './sanitize.js';
import { eventConfigurations, getFriendlyEventName } from '../config/eventsConfig.js';
import {
    addAlertSubscription,
    removeAlertSubscription,
    fetchAlertSubscriptions,
} from '../db/database.js';
import { resolveLocale } from '../i18n/index.js';

import type { AlertSubscription } from '../types/alerts.js';
import type { Client } from 'discord.js';

const subscriptions = new Map<string, AlertSubscription>();

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

/**
 * 이벤트 타입에 맞는 구독 채널로 로그 알림 메시지를 전송합니다.
 */
export async function dispatchAlert(
    eventType: string,
    guildId: string,
    userId: string | null,
    channelId: string | null,
    targetId: string | null,
    data: Record<string, unknown>,
    timestamp: Date,
    client: Client,
) {
    for (const sub of subscriptions.values()) {
        if (sub.guildId !== guildId) continue;
        if (!sub.eventTypes.includes(eventType)) continue;
        try {
            const fetched = await client.channels.fetch(sub.channelId).catch(() => null);
            if (!fetched?.isTextBased()) continue;
            const json = escapeCodeBlockContent(JSON.stringify(data).slice(0, 1800));
            const guild = await client.guilds.fetch(guildId).catch(() => null);
            const locale = resolveLocale(guild?.preferredLocale);
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

            if ('send' in fetched && typeof fetched.send === 'function') {
                await fetched.send({
                    content,
                    allowedMentions: { parse: [] },
                });
            }
        } catch (err) {
            logger.error('Failed to dispatch log alert:', err);
        }
    }
}

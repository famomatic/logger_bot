import { Client } from 'discord.js';
import { eventConfigurations } from '../config/eventsConfig.js';
import { escapeCodeBlockContent } from './sanitize.js';
import { logger } from './logger.js';
import { addAlertSubscription, removeAlertSubscription, fetchAlertSubscriptions } from '../db/database.js';

export interface AlertSubscription {
  guildId: string;
  channelId: string;
  category: string;
  eventTypes: string[];
}

const subscriptions: AlertSubscription[] = [];

// Build category map from eventConfigurations
export const categoryEventMap: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const cfg of Object.values(eventConfigurations)) {
    if (!map[cfg.category]) map[cfg.category] = [];
    map[cfg.category].push(cfg.dbEventType);
  }
  return map;
})();

export async function loadAlertSubscriptions(): Promise<void> {
  try {
    const rows = await fetchAlertSubscriptions();
    for (const row of rows) {
      const types = categoryEventMap[row.category];
      if (!types) continue;
      subscriptions.push({ guildId: row.guild_id, channelId: row.channel_id, category: row.category, eventTypes: types });
    }
    logger.info(`Loaded ${subscriptions.length} alert subscriptions.`);
  } catch (err) {
    logger.error('Failed to load alert subscriptions:', err);
  }
}

export function addSubscription(guildId: string, category: string, channelId: string): boolean {
  const types = categoryEventMap[category];
  if (!types) return false;
  subscriptions.push({ guildId, channelId, category, eventTypes: types });
  addAlertSubscription(guildId, category, channelId).catch(err => {
    logger.error('Failed to persist alert subscription:', err);
  });
  return true;
}

export function removeSubscription(guildId: string, category: string, channelId: string): boolean {
  const index = subscriptions.findIndex(s => s.guildId === guildId && s.channelId === channelId && s.category === category);
  if (index === -1) return false;
  subscriptions.splice(index, 1);
  removeAlertSubscription(guildId, category, channelId).catch(err => {
    logger.error('Failed to remove alert subscription:', err);
  });
  return true;
}

export async function dispatchAlert(
  eventType: string,
  guildId: string,
  userId: string | null,
  channelId: string | null,
  targetId: string | null,
  data: Record<string, unknown>,
  timestamp: Date,
  client: Client
) {
  for (const sub of subscriptions) {
    if (sub.guildId !== guildId) continue;
    if (!sub.eventTypes.includes(eventType)) continue;
    try {
      const fetched = await client.channels.fetch(sub.channelId).catch(() => null);
      if (!fetched?.isTextBased()) continue;
      const json = escapeCodeBlockContent(JSON.stringify(data).slice(0, 1800));
      const friendlyConfig = Object.values(eventConfigurations).find(cfg => cfg.dbEventType === eventType);
      const friendlyName = friendlyConfig?.friendlyName ?? eventType;
      const summaryLines = [
        `이벤트: ${friendlyName} (${eventType})`,
        `타임스탬프: <t:${Math.floor(timestamp.getTime() / 1000)}:F>`,
        `채널: ${channelId ? `<#${channelId}> (${channelId})` : 'N/A'}`,
        `대상 ID: ${targetId ?? 'N/A'}`,
        `사용자 ID: ${userId ?? 'N/A'}`,
      ];
      const content = `${summaryLines.join('\n')}\n\n데이터:\n\`\`\`json\n${json}\n\`\`\``;

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

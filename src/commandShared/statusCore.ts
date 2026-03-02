import { Client, WebSocketShardStatus, version as djsVersion } from 'discord.js';
import { logger } from '../utils/logger.js';
import { buildContainerMessage } from './componentsV2.js';
import type { SupportedLocale } from '../types/i18n.js';
import { t } from '../i18n/index.js';

interface StatusSnapshot {
    uptime: string;
    apiLatency: number;
    wsStatus: string;
    guilds: number;
    users: number;
    nodeVersion: string;
    slashCommandsCount: number;
    legacyCommandsCount: number;
    memoryRssMb: string;
    memoryHeapTotalMb: string;
    memoryHeapUsedMb: string;
}

/**
 * 초 단위 uptime 값을 locale 텍스트 포맷으로 변환합니다.
 */
function formatUptime(uptimeSeconds: number, locale: SupportedLocale): string {
    const d = Math.floor(uptimeSeconds / (3600 * 24));
    const h = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
    const m = Math.floor((uptimeSeconds % 3600) / 60);
    const s = Math.floor(uptimeSeconds % 60);
    return t(locale, 'status.duration', { d, h, m, s });
}

/**
 * 상태 명령 응답에 필요한 런타임/메모리/명령어 통계를 수집합니다.
 */
export async function collectStatusSnapshot(
    client: Client,
    source: 'legacy' | 'slash',
    locale: SupportedLocale,
): Promise<StatusSnapshot> {
    let apiLatency = Math.round(client.ws.ping);
    if (apiLatency === -1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        apiLatency = Math.round(client.ws.ping);
    }

    let slashCommandsCount = 0;
    if (client.application) {
        try {
            const fetchedCommands = await client.application.commands.fetch();
            slashCommandsCount = fetchedCommands?.size ?? 0;
        } catch (fetchError) {
            logger.warn(`Failed to fetch application commands for ${source} status:`, fetchError);
            slashCommandsCount = client.application.commands.cache.size ?? 0;
        }
    }

    const memoryUsage = process.memoryUsage();

    return {
        uptime: formatUptime(process.uptime(), locale),
        apiLatency,
        wsStatus: WebSocketShardStatus[client.ws.status] ?? client.ws.status.toString(),
        guilds: client.guilds.cache.size,
        users: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
        nodeVersion: process.version,
        slashCommandsCount,
        legacyCommandsCount: client.legacyCommands?.size ?? 0,
        memoryRssMb: (memoryUsage.rss / 1024 / 1024).toFixed(2),
        memoryHeapTotalMb: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2),
        memoryHeapUsedMb: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2),
    };
}

/**
 * 수집한 상태 스냅샷을 Components V2 응답 포맷으로 구성합니다.
 */
export function buildStatusReply(
    client: Client,
    snapshot: StatusSnapshot,
    locale: SupportedLocale,
    accentColor = 0x3498db,
) {
    const botName = client.user?.username ?? 'Bot';
    const botAvatar = client.user?.displayAvatarURL({ forceStatic: false, size: 128 });

    return buildContainerMessage({
        title: t(locale, 'status.title', { botName }),
        mediaGalleryItems: botAvatar
            ? [{ url: botAvatar, description: t(locale, 'status.avatar', { botName }) }]
            : undefined,
        accentColor,
        sections: [
            {
                title: t(locale, 'status.basicInfo'),
                body:
                    `${t(locale, 'status.uptime', { uptime: snapshot.uptime })}\n` +
                    `${t(locale, 'status.apiLatency', { apiLatency: snapshot.apiLatency })}\n` +
                    `${t(locale, 'status.wsStatus', { wsStatus: snapshot.wsStatus })}\n` +
                    `${t(locale, 'status.nodeVersion', { nodeVersion: snapshot.nodeVersion })}\n` +
                    `${t(locale, 'status.djsVersion', { djsVersion })}`,
            },
            {
                title: t(locale, 'status.memoryUsage'),
                body:
                    `RSS: ${snapshot.memoryRssMb} MB\n` +
                    `Heap Total: ${snapshot.memoryHeapTotalMb} MB\n` +
                    `Heap Used: ${snapshot.memoryHeapUsedMb} MB`,
            },
            {
                title: t(locale, 'status.guildStats'),
                body:
                    `${t(locale, 'status.guilds', { guilds: snapshot.guilds })}\n` +
                    `${t(locale, 'status.users', { users: snapshot.users })}\n` +
                    `${t(locale, 'status.slashCommands', { count: snapshot.slashCommandsCount })}\n` +
                    `${t(locale, 'status.legacyCommands', { count: snapshot.legacyCommandsCount })}`,
            },
        ],
        footer: t(locale, 'status.footer', { timestamp: Math.floor(Date.now() / 1000) }),
    });
}

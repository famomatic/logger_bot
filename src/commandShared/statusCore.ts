import {
    Client,
    Colors,
    EmbedBuilder,
    WebSocketShardStatus,
    version as djsVersion,
    type ColorResolvable,
} from 'discord.js';
import { logger } from '../utils/logger.js';

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

function formatUptime(uptimeSeconds: number): string {
    const d = Math.floor(uptimeSeconds / (3600 * 24));
    const h = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
    const m = Math.floor((uptimeSeconds % 3600) / 60);
    const s = Math.floor(uptimeSeconds % 60);
    return `${d}일 ${h}시간 ${m}분 ${s}초`;
}

export async function collectStatusSnapshot(
    client: Client,
    source: 'legacy' | 'slash',
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
        uptime: formatUptime(process.uptime()),
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

export function buildStatusEmbed(
    client: Client,
    snapshot: StatusSnapshot,
    color: ColorResolvable = Colors.Blue,
): EmbedBuilder {
    const botAvatar = client.user?.displayAvatarURL({ forceStatic: false, size: 128 });

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(`${client.user?.username ?? '봇'} 상태 정보`)
        .setThumbnail(botAvatar ?? null)
        .addFields(
            {
                name: '기본 정보',
                value:
                    `**업타임:** ${snapshot.uptime}\n` +
                    `**Discord API 지연시간:** ${snapshot.apiLatency}ms\n` +
                    `**웹소켓 상태:** ${snapshot.wsStatus}\n` +
                    `**Node.js 버전:** ${snapshot.nodeVersion}\n` +
                    `**Discord.js 버전:** v${djsVersion}`,
                inline: false,
            },
            {
                name: '메모리 사용량',
                value:
                    `**RSS:** ${snapshot.memoryRssMb} MB\n` +
                    `**Heap Total:** ${snapshot.memoryHeapTotalMb} MB\n` +
                    `**Heap Used:** ${snapshot.memoryHeapUsedMb} MB`,
                inline: false,
            },
            {
                name: '서버 및 명령어 현황',
                value:
                    `**연결된 서버 수:** ${snapshot.guilds}개\n` +
                    `**전체 사용자 수 (캐시 기준):** ${snapshot.users}명\n` +
                    `**로드된 슬래시 명령어:** ${snapshot.slashCommandsCount}개\n` +
                    `**로드된 레거시 명령어:** ${snapshot.legacyCommandsCount}개`,
                inline: false,
            },
        )
        .setTimestamp()
        .setFooter({ text: '상태 정보' });
}

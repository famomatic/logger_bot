import {
    Message,
    version as djsVersion,
    EmbedBuilder,
    Colors,
    WebSocketShardStatus,
} from 'discord.js';
import { LegacyCommand } from '../utils/loadLegacyCommands.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

// Helper function to format uptime
function formatUptime(uptimeSeconds: number): string {
    const d = Math.floor(uptimeSeconds / (3600 * 24));
    const h = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
    const m = Math.floor((uptimeSeconds % 3600) / 60);
    const s = Math.floor(uptimeSeconds % 60);
    return `${d}일 ${h}시간 ${m}분 ${s}초`;
}

const command: LegacyCommand = {
    name: 'status',
    async execute(message: Message) {
        if (config.getDevLevel(message.author.id) < 1) {
            await message.reply('이 명령어는 개발자만 사용할 수 있습니다.');
            return;
        }
        try {
            const client = message.client;
            const uptime = formatUptime(process.uptime());
            const memoryUsage = process.memoryUsage();
            let apiLatency = Math.round(client.ws.ping);
            if (apiLatency === -1) {
                // Try to wait a bit and fetch again if ping is -1, as it might be an initial value
                await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
                apiLatency = Math.round(client.ws.ping);
            }
            const wsStatus = client.ws.status; // 웹소켓 상태 가져오기

            const guilds = client.guilds.cache.size;
            const users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
            const nodeVersion = process.version;

            let slashCommandsCount = 0;
            if (client.application) {
                try {
                    const fetchedCommands = await client.application.commands.fetch();
                    slashCommandsCount = fetchedCommands?.size ?? 0;
                } catch (fetchError) {
                    logger.warn(
                        'Failed to fetch application commands for legacy status:',
                        fetchError,
                    );
                    slashCommandsCount = client.application.commands.cache.size ?? 0; // Fallback to cache
                }
            }

            const legacyCommandsCount = client.legacyCommands?.size ?? 0;

            const botAvatar = client.user?.displayAvatarURL({ forceStatic: false, size: 128 });

            const embed = new EmbedBuilder()
                .setColor(Colors.Aqua)
                .setTitle(`${client.user?.username ?? '봇'} 상태 정보`)
                .setThumbnail(botAvatar ?? null)
                .addFields(
                    {
                        name: '기본 정보',
                        value:
                            `**업타임:** ${uptime}\n` +
                            `**Discord API 지연시간:** ${apiLatency}ms\n` +
                            `**웹소켓 상태:** ${WebSocketShardStatus[wsStatus] ?? wsStatus.toString()}\n` + // WebSocketShardStatus 사용
                            `**Node.js 버전:** ${nodeVersion}\n` +
                            `**Discord.js 버전:** v${djsVersion}`,
                        inline: false,
                    },
                    {
                        name: '메모리 사용량',
                        value:
                            `**RSS:** ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB\n` +
                            `**Heap Total:** ${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB\n` +
                            `**Heap Used:** ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                        inline: false,
                    },
                    {
                        name: '서버 및 명령어 현황',
                        value:
                            `**연결된 서버 수:** ${guilds}개\n` +
                            `**전체 사용자 수 (캐시 기준):** ${users}명\n` +
                            `**로드된 슬래시 명령어:** ${slashCommandsCount}개\n` +
                            `**로드된 레거시 명령어:** ${legacyCommandsCount}개`,
                        inline: false,
                    },
                )
                .setTimestamp()
                .setFooter({ text: '상태 정보' });

            await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        } catch (error) {
            const err = error as Error;
            logger.error('Error executing legacy status command:', err);
            logger.error(
                'Full error object for legacy status:',
                JSON.stringify(err, Object.getOwnPropertyNames(err)),
            );
            await message.reply({
                content: `상태 정보를 가져오는 중 오류가 발생했습니다: ${err.message}`,
                allowedMentions: { parse: [] },
            });
        }
    },
};

export { command };

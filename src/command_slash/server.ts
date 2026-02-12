import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors,
    GuildPremiumTier,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import { getGuildLogStats, isGuildAuthorized } from '../db/database.js';

function formatNumber(value: number): string {
    return value.toLocaleString('ko-KR');
}

async function formatDevLevelList(
    interaction: ChatInputCommandInteraction,
    ids: string[] | undefined,
): Promise<string> {
    if (!ids || ids.length === 0) {
        return '없음';
    }

    const formatted = await Promise.all(
        ids.map(async (id) => {
            const cached = interaction.client.users.cache.get(id);
            if (cached) {
                return `${cached.tag} (${id})`;
            }
            try {
                const fetched = await interaction.client.users.fetch(id);
                return `${fetched.tag} (${id})`;
            } catch {
                return `ID: ${id}`;
            }
        }),
    );

    return formatted.join('\n');
}

export const command = {
    data: new SlashCommandBuilder()
        .setName('server')
        .setDescription('현재 서버의 로깅 및 설정 정보를 보여줍니다.')
        .setDMPermission(false),
    async execute(interaction: ChatInputCommandInteraction) {
        logger.info(`/server command executed by ${interaction.user.tag}`);

        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버에서만 사용할 수 있습니다.',
                ephemeral: true,
            });
            return;
        }

        try {
            await interaction.deferReply({ ephemeral: false });

            const guild = interaction.guild!;
            const authorized = isGuildAuthorized(guild.id);
            const stats = await getGuildLogStats(guild.id);
            const owner = await guild.fetchOwner().catch(() => null);

            const level3List = await formatDevLevelList(interaction, config.devLevels.level3);
            const level2List = await formatDevLevelList(interaction, config.devLevels.level2);
            const level1List = await formatDevLevelList(interaction, config.devLevels.level1);

            const premiumTierName = GuildPremiumTier[guild.premiumTier] ?? guild.premiumTier;

            const infoLines = [
                `**ID:** ${guild.id}`,
                `**소유자:** ${owner ? `${owner.user.tag} (${owner.id})` : '정보 없음'}`,
                `**생성일:** <t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                `**멤버 수:** ${guild.memberCount !== null && guild.memberCount !== undefined ? formatNumber(guild.memberCount) : '알 수 없음'}`,
                `**부스트 레벨:** ${premiumTierName}`,
            ];

            const statsLines = [
                `**인증 상태:** ${authorized ? '✅ 인증됨' : '❌ 미인증'}`,
                `**총 로그 수:** ${formatNumber(stats.totalLogs)}건`,
                `**메시지 로그(생성):** ${formatNumber(stats.messageCreateCount)}건`,
                `**텍스트 메시지 수:** ${formatNumber(stats.textMessageCount)}건`,
                `**텍스트 총 글자 수:** ${formatNumber(stats.totalTextCharacters)}자`,
                `**첨부파일 수:** ${formatNumber(stats.attachmentCount)}개`,
                `**스티커 수:** ${formatNumber(stats.stickerCount)}개`,
            ];

            const devLevelLines = [
                `**레벨 3:** ${level3List}`,
                `**레벨 2:** ${level2List}`,
                `**레벨 1:** ${level1List}`,
            ];

            const embed = new EmbedBuilder()
                .setColor(authorized ? Colors.Green : Colors.Orange)
                .setTitle(`${guild.name} 서버 정보`)
                .setThumbnail(guild.iconURL({ size: 256, forceStatic: false }) ?? null)
                .addFields(
                    { name: '기본 정보', value: infoLines.join('\n'), inline: false },
                    { name: '인증 및 로그 현황', value: statsLines.join('\n'), inline: false },
                    { name: '개발자 레벨', value: devLevelLines.join('\n'), inline: false },
                )
                .setTimestamp(new Date())
                .setFooter({ text: `요청자: ${interaction.user.tag}` });

            await interaction.editReply({
                embeds: [embed],
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error('Error executing /server command:', err);
            const errorMessage = err.message || '알 수 없는 오류';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: `서버 정보를 불러오지 못했습니다: ${errorMessage}`,
                    embeds: [],
                    components: [],
                });
            } else {
                await interaction.reply({
                    content: `서버 정보를 불러오지 못했습니다: ${errorMessage}`,
                    ephemeral: true,
                });
            }
        }
    },
};

import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    GuildPremiumTier,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import { getGuildReport, isGuildAuthorized } from '../db/database.js';
import { buildContainerMessage } from '../commandShared/componentsV2.js';
import {
    formatEntityCountList,
    formatEventTypeCountList,
    formatLocalizedNumber,
    formatUserTagListFromIds,
} from '../utils/reportFormatters.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('report-guild')
        .setDescription('현재 서버의 로그 운영 리포트를 보여줍니다.')
        .setContexts(InteractionContextType.Guild),
    async execute(interaction: ChatInputCommandInteraction) {
        logger.info(`/report-guild command executed by ${interaction.user.tag}`);

        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버에서만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            });

            const guild = interaction.guild!;
            const authorized = isGuildAuthorized(guild.id);
            const report = await getGuildReport(guild.id);
            const owner = await guild.fetchOwner().catch(() => null);
            const guildIconUrl = guild.iconURL({ size: 1024, forceStatic: false }) ?? undefined;
            const guildBannerUrl = guild.bannerURL({ size: 1024, forceStatic: false }) ?? undefined;

            const level3List = await formatUserTagListFromIds(
                interaction.client,
                config.devLevels.level3,
            );
            const level2List = await formatUserTagListFromIds(
                interaction.client,
                config.devLevels.level2,
            );
            const level1List = await formatUserTagListFromIds(
                interaction.client,
                config.devLevels.level1,
            );

            const premiumTierName = GuildPremiumTier[guild.premiumTier] ?? guild.premiumTier;

            const infoLines = [
                `**ID:** ${guild.id}`,
                `**소유자:** ${owner ? `${owner.user.tag} (${owner.id})` : '정보 없음'}`,
                `**생성일:** <t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                `**멤버 수:** ${
                    guild.memberCount !== null && guild.memberCount !== undefined
                        ? formatLocalizedNumber(guild.memberCount)
                        : '알 수 없음'
                }`,
                `**부스트 레벨:** ${premiumTierName}`,
            ];

            const statsLines = [
                `**인증 상태:** ${authorized ? '✅ 인증됨' : '❌ 미인증'}`,
                `**총 로그 수:** ${formatLocalizedNumber(report.totalLogs)}건`,
                `**메시지 생성/수정/삭제:** ${formatLocalizedNumber(report.messageCreateCount)} / ${formatLocalizedNumber(report.messageUpdateCount)} / ${formatLocalizedNumber(report.messageDeleteCount)}`,
                `**운영 이벤트 수(밴/대량삭제/강퇴):** ${formatLocalizedNumber(report.moderationActionCount)}건`,
                `**첨부파일 수:** ${formatLocalizedNumber(report.attachmentCount)}개`,
                `**스티커 수:** ${formatLocalizedNumber(report.stickerCount)}개`,
                `**최근 활동:** ${report.lastActivityAt ? `<t:${Math.floor(report.lastActivityAt.getTime() / 1000)}:F>` : '기록 없음'}`,
            ];

            const trendText =
                report.trendPercent === null
                    ? '신규 급증(비교 기준 0)'
                    : `${report.trendPercent > 0 ? '+' : ''}${report.trendPercent}%`;
            const anomalyLines = [
                `**최근 24시간 로그:** ${formatLocalizedNumber(report.last24hCount)}건`,
                `**그 이전 24시간 로그:** ${formatLocalizedNumber(report.prev24hCount)}건`,
                `**변화율:** ${trendText}`,
                `**상위 이벤트 타입:**\n${formatEventTypeCountList(report.topEventTypes)}`,
                `**상위 채널:**\n${formatEntityCountList(report.topChannels, 'channel')}`,
                `**상위 사용자:**\n${formatEntityCountList(report.topUsers, 'user')}`,
            ];

            const devLevelLines = [
                `**레벨 3:** ${level3List}`,
                `**레벨 2:** ${level2List}`,
                `**레벨 1:** ${level1List}`,
            ];

            await interaction.editReply(
                buildContainerMessage({
                    title: `${guild.name} 서버 정보`,
                    description: `서버: ${guild.name} (${guild.id})`,
                    mediaGalleryItems: [
                        ...(guildIconUrl
                            ? [{ url: guildIconUrl, description: `${guild.name} 아이콘` }]
                            : []),
                        ...(guildBannerUrl
                            ? [{ url: guildBannerUrl, description: `${guild.name} 배너` }]
                            : []),
                    ],
                    accentColor: authorized ? 0x57f287 : 0xfee75c,
                    sections: [
                        { title: '기본 정보', body: infoLines.join('\n') },
                        { title: '로그 요약', body: statsLines.join('\n') },
                        { title: '활동 추세/이상징후', body: anomalyLines.join('\n') },
                        { title: '개발자 레벨', body: devLevelLines.join('\n') },
                    ],
                    footer: `요청자: ${interaction.user.tag}`,
                }),
            );
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error('Error executing /report-guild command:', err);
            const errorMessage = err.message || '알 수 없는 오류';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    ...buildContainerMessage({
                        title: '오류',
                        description: `서버 정보를 불러오지 못했습니다: ${errorMessage}`,
                        accentColor: 0xed4245,
                    }),
                });
            } else {
                await interaction.reply({
                    content: `서버 정보를 불러오지 못했습니다: ${errorMessage}`,
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    },
};

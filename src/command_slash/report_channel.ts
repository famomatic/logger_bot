import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionsBitField,
    InteractionContextType,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import { getChannelReport } from '../db/database.js';
import { buildContainerMessage } from '../commandShared/componentsV2.js';
import {
    formatEntityCountList,
    formatEventTypeCountList,
    formatLocalizedNumber,
} from '../utils/reportFormatters.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('report-channel')
        .setDescription('특정 채널의 로그 리포트를 보여줍니다.')
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription('리포트를 조회할 채널 ID')
                .setRequired(true),
        )
        .setContexts(InteractionContextType.Guild),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버에서만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 2 && !isAdmin) {
            await interaction.reply({
                content: '이 명령어는 레벨2 이상 개발자 또는 관리자만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const channelIdRaw = interaction.options.getString('channel_id', true).trim();
        if (!/^\d{17,20}$/.test(channelIdRaw)) {
            await interaction.reply({
                content: '오류: 채널은 ID로 입력해주세요. (예: 123456789012345678)',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        logger.info(
            `/report-channel command executed by ${interaction.user.tag} for ${channelIdRaw}`,
        );

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });

        const report = await getChannelReport(interaction.guildId, channelIdRaw);
        const trendText =
            report.trendPercent === null
                ? '신규 급증(비교 기준 0)'
                : `${report.trendPercent > 0 ? '+' : ''}${report.trendPercent}%`;

        await interaction.editReply(
            buildContainerMessage({
                title: '채널 로그 리포트',
                description: `채널: <#${channelIdRaw}> (${channelIdRaw})`,
                accentColor: 0x5865f2,
                sections: [
                    {
                        title: '핵심 지표',
                        body: [
                            `총 로그 수: ${formatLocalizedNumber(report.totalLogs)}건`,
                            `메시지 생성/수정/삭제: ${formatLocalizedNumber(report.messageCreateCount)} / ${formatLocalizedNumber(report.messageUpdateCount)} / ${formatLocalizedNumber(report.messageDeleteCount)}`,
                            `운영 이벤트 수: ${formatLocalizedNumber(report.moderationActionCount)}건`,
                            `첨부파일 수: ${formatLocalizedNumber(report.attachmentCount)}개`,
                            `스티커 수: ${formatLocalizedNumber(report.stickerCount)}개`,
                            `최근 활동: ${report.lastActivityAt ? `<t:${Math.floor(report.lastActivityAt.getTime() / 1000)}:F>` : '기록 없음'}`,
                        ].join('\n'),
                    },
                    {
                        title: '추세/이상징후',
                        body: [
                            `최근 24시간 로그: ${formatLocalizedNumber(report.last24hCount)}건`,
                            `그 이전 24시간 로그: ${formatLocalizedNumber(report.prev24hCount)}건`,
                            `변화율: ${trendText}`,
                            `상위 이벤트 타입:\n${formatEventTypeCountList(report.topEventTypes)}`,
                            `상위 사용자:\n${formatEntityCountList(report.topUsers, 'user')}`,
                        ].join('\n'),
                    },
                ],
                footer: `요청자: ${interaction.user.tag}`,
            }),
        );
    },
};

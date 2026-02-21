import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionsBitField,
    InteractionContextType,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import { getUserReport } from '../db/database.js';
import { buildContainerMessage } from '../commandShared/componentsV2.js';
import type { ReportEventTypeCount, ReportIdCount } from '../types/report.js';

function formatNumber(value: number): string {
    return value.toLocaleString('ko-KR');
}

function formatEventTypeList(eventTypes: ReportEventTypeCount[]): string {
    if (eventTypes.length === 0) {
        return '없음';
    }

    return eventTypes
        .map((item, index) => `${index + 1}. ${item.eventType} - ${formatNumber(item.count)}건`)
        .join('\n');
}

function formatChannelList(channels: ReportIdCount[]): string {
    if (channels.length === 0) {
        return '없음';
    }

    return channels
        .map(
            (item, index) =>
                `${index + 1}. <#${item.id}> (ID: \`${item.id}\`) - ${formatNumber(item.count)}건`,
        )
        .join('\n');
}

export const command = {
    data: new SlashCommandBuilder()
        .setName('report-user')
        .setDescription('특정 사용자의 로그 리포트를 보여줍니다.')
        .addUserOption((option) =>
            option.setName('user').setDescription('리포트를 조회할 사용자').setRequired(true),
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

        const user = interaction.options.getUser('user', true);
        logger.info(`/report-user command executed by ${interaction.user.tag} for ${user.id}`);

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });

        const report = await getUserReport(interaction.guildId, user.id);
        const trendText =
            report.trendPercent === null
                ? '신규 급증(비교 기준 0)'
                : `${report.trendPercent > 0 ? '+' : ''}${report.trendPercent}%`;

        await interaction.editReply(
            buildContainerMessage({
                title: '사용자 로그 리포트',
                description: `사용자: <@${user.id}> (${user.id})`,
                accentColor: 0x57f287,
                sections: [
                    {
                        title: '핵심 지표',
                        body: [
                            `총 로그 수: ${formatNumber(report.totalLogs)}건`,
                            `메시지 생성/수정/삭제: ${formatNumber(report.messageCreateCount)} / ${formatNumber(report.messageUpdateCount)} / ${formatNumber(report.messageDeleteCount)}`,
                            `운영 이벤트 수: ${formatNumber(report.moderationActionCount)}건`,
                            `첨부파일 수: ${formatNumber(report.attachmentCount)}개`,
                            `스티커 수: ${formatNumber(report.stickerCount)}개`,
                            `최근 활동: ${report.lastActivityAt ? `<t:${Math.floor(report.lastActivityAt.getTime() / 1000)}:F>` : '기록 없음'}`,
                        ].join('\n'),
                    },
                    {
                        title: '추세/이상징후',
                        body: [
                            `최근 24시간 로그: ${formatNumber(report.last24hCount)}건`,
                            `그 이전 24시간 로그: ${formatNumber(report.prev24hCount)}건`,
                            `변화율: ${trendText}`,
                            `상위 이벤트 타입:\n${formatEventTypeList(report.topEventTypes)}`,
                            `상위 채널:\n${formatChannelList(report.topChannels)}`,
                        ].join('\n'),
                    },
                ],
                footer: `요청자: ${interaction.user.tag}`,
            }),
        );
    },
};

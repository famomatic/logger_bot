import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors,
    MessageFlags,
    PermissionsBitField,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import { getChannelReport } from '../db/database.js';

function formatNumber(value: number): string {
    return value.toLocaleString('ko-KR');
}

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
        .setDMPermission(false),
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

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const report = await getChannelReport(interaction.guildId, channelIdRaw);
        const trendText =
            report.trendPercent === null
                ? '신규 급증(비교 기준 0)'
                : `${report.trendPercent > 0 ? '+' : ''}${report.trendPercent}%`;

        const embed = new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle('채널 로그 리포트')
            .setDescription(`채널: <#${channelIdRaw}> (${channelIdRaw})`)
            .addFields(
                {
                    name: '핵심 지표',
                    value: [
                        `총 로그 수: ${formatNumber(report.totalLogs)}건`,
                        `메시지 생성/수정/삭제: ${formatNumber(report.messageCreateCount)} / ${formatNumber(report.messageUpdateCount)} / ${formatNumber(report.messageDeleteCount)}`,
                        `운영 이벤트 수: ${formatNumber(report.moderationActionCount)}건`,
                        `첨부파일 수: ${formatNumber(report.attachmentCount)}개`,
                        `스티커 수: ${formatNumber(report.stickerCount)}개`,
                        `최근 활동: ${report.lastActivityAt ? `<t:${Math.floor(report.lastActivityAt.getTime() / 1000)}:F>` : '기록 없음'}`,
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: '추세/이상징후',
                    value: [
                        `최근 24시간 로그: ${formatNumber(report.last24hCount)}건`,
                        `그 이전 24시간 로그: ${formatNumber(report.prev24hCount)}건`,
                        `변화율: ${trendText}`,
                        `상위 이벤트 타입: ${
                            report.topEventTypes.length > 0
                                ? report.topEventTypes
                                      .map(
                                          (item) =>
                                              `${item.eventType}(${formatNumber(item.count)})`,
                                      )
                                      .join(', ')
                                : '없음'
                        }`,
                        `상위 사용자: ${
                            report.topUsers.length > 0
                                ? report.topUsers
                                      .map((item) => `<@${item.id}>(${formatNumber(item.count)})`)
                                      .join(', ')
                                : '없음'
                        }`,
                    ].join('\n'),
                    inline: false,
                },
            )
            .setTimestamp(new Date())
            .setFooter({ text: `요청자: ${interaction.user.tag}` });

        await interaction.editReply({
            embeds: [embed],
            allowedMentions: { parse: [] },
        });
    },
};

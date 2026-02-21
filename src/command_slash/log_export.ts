import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionsBitField,
    AttachmentBuilder,
    InteractionContextType,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import { getEventTypeChoices, isValidEventType } from '../config/eventsConfig.js';
import { parseDateString } from '../commandShared/logSearchShared.js';
import { searchLogs } from '../db/database.js';
import type { LogEntry } from '../types/logs.js';

type ExportFormat = 'json' | 'csv';
const EXPORT_PAGE_SIZE = 500;
const DEFAULT_MAX_ROWS = 1000;

function escapeCsvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

function normalizeTimestamp(value: Date): string {
    const asDate = value instanceof Date ? value : new Date(value);
    return asDate.toISOString();
}

function toCsv(rows: LogEntry[]): string {
    const header = [
        'id',
        'timestamp',
        'event_type',
        'guild_id',
        'channel_id',
        'user_id',
        'target_id',
        'event_data',
    ].join(',');

    const body = rows.map((row) => {
        const columns = [
            String(row.id),
            normalizeTimestamp(row.timestamp),
            row.event_type,
            row.guild_id,
            row.channel_id ?? '',
            row.user_id ?? '',
            row.target_id ?? '',
            JSON.stringify(row.event_data ?? {}),
        ];
        return columns.map(escapeCsvCell).join(',');
    });

    return [header, ...body].join('\n');
}

export const command = {
    data: new SlashCommandBuilder()
        .setName('log-export')
        .setDescription('조건에 맞는 로그를 파일(JSON/CSV)로 내보냅니다.')
        .addStringOption((option) =>
            option
                .setName('format')
                .setDescription('내보내기 포맷')
                .setRequired(true)
                .addChoices({ name: 'JSON', value: 'json' }, { name: 'CSV', value: 'csv' }),
        )
        .addIntegerOption((option) =>
            option
                .setName('max_rows')
                .setDescription('최대 추출 개수 (1~5000, 기본 1000)')
                .setMinValue(1)
                .setMaxValue(5000)
                .setRequired(false),
        )
        .addUserOption((option) =>
            option.setName('user').setDescription('검색할 사용자').setRequired(false),
        )
        .addStringOption((option) =>
            option.setName('channel').setDescription('검색할 채널 ID').setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('start-date')
                .setDescription('검색 시작일 (YYYY-MM-DD)')
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('end-date')
                .setDescription('검색 종료일 (YYYY-MM-DD)')
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('event-type')
                .setDescription('이벤트 유형')
                .setRequired(false)
                .addChoices(...getEventTypeChoices()),
        )
        .addStringOption((option) =>
            option
                .setName('keyword')
                .setDescription('텍스트 키워드 (content/newContent/oldContent)')
                .setRequired(false),
        )
        .setContexts(InteractionContextType.Guild),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({
                content: '이 명령어는 서버 내에서만 사용할 수 있습니다.',
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

        const format = interaction.options.getString('format', true) as ExportFormat;
        const maxRows = interaction.options.getInteger('max_rows') ?? DEFAULT_MAX_ROWS;
        const targetUser = interaction.options.getUser('user');
        const targetChannelIdInput = interaction.options.getString('channel');
        const startDateString = interaction.options.getString('start-date');
        const endDateString = interaction.options.getString('end-date');
        const keyword = interaction.options.getString('keyword')?.trim() ?? undefined;
        const rawEventType = interaction.options.getString('event-type');

        let targetChannelId: string | undefined;
        if (targetChannelIdInput) {
            const trimmed = targetChannelIdInput.trim();
            if (!/^\d{17,20}$/.test(trimmed)) {
                await interaction.reply({
                    content: '오류: 채널은 ID로 입력해주세요. (예: 123456789012345678)',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            targetChannelId = trimmed;
        }

        let eventType: string | undefined;
        if (rawEventType) {
            if (!isValidEventType(rawEventType)) {
                await interaction.reply({
                    content: `오류: 유효하지 않은 이벤트 유형입니다: \`${rawEventType}\``,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            eventType = rawEventType;
        }

        let startDate: Date | undefined;
        let endDate: Date | undefined;

        if (startDateString) {
            const parsed = parseDateString(startDateString, false);
            if (!parsed) {
                await interaction.reply({
                    content:
                        '오류: 유효하지 않은 시작 날짜 형식입니다. YYYY-MM-DD 형식으로 입력해주세요.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            startDate = parsed;
        }

        if (endDateString) {
            const parsed = parseDateString(endDateString, true);
            if (!parsed) {
                await interaction.reply({
                    content:
                        '오류: 유효하지 않은 종료 날짜 형식입니다. YYYY-MM-DD 형식으로 입력해주세요.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            endDate = parsed;
        }

        if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
            await interaction.reply({
                content: '오류: 검색 시작일이 종료일보다 늦을 수 없습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        logger.info(
            `/log-export command executed by ${interaction.user.tag} with format ${format}`,
        );

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const exportedRows: LogEntry[] = [];
        let offset = 0;
        let totalCount = 0;

        while (exportedRows.length < maxRows) {
            const batchSize = Math.min(EXPORT_PAGE_SIZE, maxRows - exportedRows.length);
            const { logs, totalCount: currentTotal } = await searchLogs({
                guildId: interaction.guildId,
                keyword,
                userId: targetUser?.id,
                channelId: targetChannelId,
                startDate,
                endDate,
                eventType,
                limit: batchSize,
                offset,
            });

            totalCount = currentTotal;
            if (logs.length === 0) {
                break;
            }

            exportedRows.push(...logs);
            offset += logs.length;

            if (offset >= totalCount) {
                break;
            }
        }

        if (exportedRows.length === 0) {
            await interaction.editReply({
                content: '조건에 맞는 로그가 없습니다.',
                embeds: [],
                components: [],
            });
            return;
        }

        const nowStamp = new Date().toISOString().replace(/[:.]/g, '-');
        let fileName = `log-export-${interaction.guildId}-${nowStamp}`;
        let fileBuffer: Buffer;

        if (format === 'json') {
            fileName += '.json';
            fileBuffer = Buffer.from(
                JSON.stringify(
                    exportedRows.map((row) => ({
                        ...row,
                        timestamp: normalizeTimestamp(row.timestamp),
                    })),
                    null,
                    2,
                ),
                'utf8',
            );
        } else {
            fileName += '.csv';
            fileBuffer = Buffer.from(toCsv(exportedRows), 'utf8');
        }

        const attachment = new AttachmentBuilder(fileBuffer, { name: fileName });
        const truncated = totalCount > exportedRows.length;

        await interaction.editReply({
            content: [
                `내보내기 완료: ${exportedRows.length.toLocaleString('ko-KR')}건`,
                `포맷: ${format.toUpperCase()}`,
                truncated
                    ? `주의: 조건 일치 전체 ${totalCount.toLocaleString('ko-KR')}건 중 ${exportedRows.length.toLocaleString('ko-KR')}건만 추출했습니다. (max_rows 제한)`
                    : `전체 ${totalCount.toLocaleString('ko-KR')}건을 모두 추출했습니다.`,
            ].join('\n'),
            files: [attachment],
            allowedMentions: { parse: [] },
        });
    },
};

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
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';

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

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('log-export')
        .setDescription(defaultText('logExport.description'))
        .addStringOption((option) =>
            option
                .setName('format')
                .setDescription(defaultText('logExport.format'))
                .setRequired(true)
                .addChoices({ name: 'JSON', value: 'json' }, { name: 'CSV', value: 'csv' }),
        )
        .addIntegerOption((option) =>
            option
                .setName('max_rows')
                .setDescription(defaultText('logExport.maxRows'))
                .setMinValue(1)
                .setMaxValue(5000)
                .setRequired(false),
        )
        .addUserOption((option) =>
            option.setName('user').setDescription(defaultText('logExport.user')).setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('channel')
                .setDescription(defaultText('logExport.channel'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('start-date')
                .setDescription(defaultText('logExport.startDate'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('end-date')
                .setDescription(defaultText('logExport.endDate'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('event-type')
                .setDescription(defaultText('logExport.eventType'))
                .setRequired(false)
                .addChoices(...getEventTypeChoices()),
        )
        .addStringOption((option) =>
            option
                .setName('keyword')
                .setDescription(defaultText('logExport.keyword'))
                .setRequired(false),
        )
        .setContexts(InteractionContextType.Guild),
    async execute(interaction: ChatInputCommandInteraction) {
        const locale = getInteractionLocale(interaction);
        if (!interaction.guildId) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuildStrict'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 2 && !isAdmin) {
            await interaction.reply({
                content: t(locale, 'common.level2OrAdminOnly'),
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
                    content: t(locale, 'common.invalidChannelIdInput'),
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
                    content: t(locale, 'common.invalidEventType', { eventType: rawEventType }),
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
                    content: t(locale, 'common.invalidStartDate'),
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
                    content: t(locale, 'common.invalidEndDate'),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            endDate = parsed;
        }

        if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
            await interaction.reply({
                content: t(locale, 'common.startAfterEnd'),
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
                content: t(locale, 'logExport.noLogs'),
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
                t(locale, 'logExport.doneCount', {
                    count: exportedRows.length.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US'),
                }),
                t(locale, 'logExport.formatLine', { format: format.toUpperCase() }),
                truncated
                    ? t(locale, 'logExport.truncated', {
                          total: totalCount.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US'),
                          count: exportedRows.length.toLocaleString(
                              locale === 'ko' ? 'ko-KR' : 'en-US',
                          ),
                      })
                    : t(locale, 'logExport.full', {
                          total: totalCount.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US'),
                      }),
            ].join('\n'),
            files: [attachment],
            allowedMentions: { parse: [] },
        });
    },
};

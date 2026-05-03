import { SlashCommandBuilder, MessageFlags, InteractionContextType } from 'discord.js';

import { buildContainerMessage } from '../commandShared/componentsV2.js';
import { parseDateString } from '../commandShared/logSearchShared.js';
import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { getEventTypeChoices, isValidEventType } from '../config/eventsConfig.js';
import { getChannelReport } from '../db/logQueries.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';
import {
    formatEntityCountList,
    formatEventTypeCountList,
    formatLocalizedNumber,
} from '../utils/reportFormatters.js';

import type { ChatInputCommandInteraction } from 'discord.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('report-channel')
        .setDescription(defaultText('reportCommand.channelDescription'))
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription(defaultText('reportCommand.channelId'))
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('start-date')
                .setDescription(defaultText('reportCommand.startDate'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('end-date')
                .setDescription(defaultText('reportCommand.endDate'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('event-type')
                .setDescription(defaultText('reportCommand.eventType'))
                .setRequired(false)
                .addChoices(...getEventTypeChoices()),
        )
        .addBooleanOption((option) =>
            option.setName('ephemeral').setDescription(defaultText('reportCommand.ephemeral')),
        )
        .setContexts(InteractionContextType.Guild),
    async execute(interaction: ChatInputCommandInteraction) {
        const locale = getInteractionLocale(interaction);
        const numberLocale = locale === 'ko' ? 'ko-KR' : 'en-US';
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuild'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (!(await ensureSlashCommandPermission(interaction))) {
            return;
        }

        const channelIdRaw = interaction.options.getString('channel_id', true).trim();
        if (!/^\d{17,20}$/.test(channelIdRaw)) {
            await interaction.reply({
                content: t(locale, 'common.invalidChannelIdInput'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const startDateString = interaction.options.getString('start-date');
        const endDateString = interaction.options.getString('end-date');
        const eventTypeInput = interaction.options.getString('event-type');

        let startDate: Date | undefined = undefined;
        let endDate: Date | undefined = undefined;
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
        if (startDate && !endDate) {
            endDate = new Date(startDate);
            endDate.setUTCHours(23, 59, 59, 999);
        }
        if (!startDate && endDate) {
            startDate = new Date(endDate);
            startDate.setUTCHours(0, 0, 0, 0);
        }

        let validatedEventType: string | undefined = undefined;
        if (eventTypeInput) {
            if (!isValidEventType(eventTypeInput)) {
                await interaction.reply({
                    content: t(locale, 'common.invalidEventType', { eventType: eventTypeInput }),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            validatedEventType = eventTypeInput;
        }

        logger.info(
            `/report-channel command executed by ${interaction.user.tag} for ${channelIdRaw}`,
        );

        const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;
        await interaction.deferReply({
            flags: ephemeral
                ? MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
                : MessageFlags.IsComponentsV2,
        });

        const report = await getChannelReport(interaction.guildId, channelIdRaw, {
            startDate,
            endDate,
            eventType: validatedEventType,
        });
        const trendText =
            report.trendPercent === null
                ? t(locale, 'report.trendNew')
                : `${report.trendPercent > 0 ? '+' : ''}${report.trendPercent}%`;
        const periodText =
            startDate && endDate
                ? `<t:${Math.floor(startDate.getTime() / 1000)}:D> ~ <t:${Math.floor(endDate.getTime() / 1000)}:D>`
                : t(locale, 'reportCommand.filterAny');
        const eventText = validatedEventType ?? t(locale, 'reportCommand.filterAny');
        const selectedEventPeakDateText =
            report.selectedEventPeakDate === null
                ? t(locale, 'report.recordsNone')
                : `<t:${Math.floor(report.selectedEventPeakDate.getTime() / 1000)}:D>`;

        await interaction.editReply(
            buildContainerMessage({
                title: t(locale, 'reportCommand.channelTitle'),
                description: t(locale, 'reportCommand.channelDescriptionLine', {
                    channelId: channelIdRaw,
                }),
                accentColor: 0x5865f2,
                sections: [
                    {
                        title: t(locale, 'reportCommand.sectionCore'),
                        body: [
                            t(locale, 'reportCommand.totalLogs', {
                                count: formatLocalizedNumber(report.totalLogs, numberLocale),
                            }),
                            t(locale, 'reportCommand.filterPeriod', { value: periodText }),
                            t(locale, 'reportCommand.filterEvent', { value: eventText }),
                            t(locale, 'reportCommand.msg3', {
                                create: formatLocalizedNumber(
                                    report.messageCreateCount,
                                    numberLocale,
                                ),
                                update: formatLocalizedNumber(
                                    report.messageUpdateCount,
                                    numberLocale,
                                ),
                                delete: formatLocalizedNumber(
                                    report.messageDeleteCount,
                                    numberLocale,
                                ),
                            }),
                            t(locale, 'reportCommand.moderation', {
                                count: formatLocalizedNumber(
                                    report.moderationActionCount,
                                    numberLocale,
                                ),
                            }),
                            t(locale, 'reportCommand.attachments', {
                                count: formatLocalizedNumber(report.attachmentCount, numberLocale),
                            }),
                            t(locale, 'reportCommand.stickers', {
                                count: formatLocalizedNumber(report.stickerCount, numberLocale),
                            }),
                            t(locale, 'reportCommand.lastActivity', {
                                value: report.lastActivityAt
                                    ? `<t:${Math.floor(report.lastActivityAt.getTime() / 1000)}:F>`
                                    : t(locale, 'report.recordsNone'),
                            }),
                        ].join('\n'),
                    },
                    {
                        title: t(locale, 'reportCommand.sectionAnomaly'),
                        body: [
                            t(locale, 'reportCommand.last24h', {
                                count: formatLocalizedNumber(report.last24hCount, numberLocale),
                            }),
                            t(locale, 'reportCommand.prev24h', {
                                count: formatLocalizedNumber(report.prev24hCount, numberLocale),
                            }),
                            t(locale, 'reportCommand.trend', { value: trendText }),
                            t(locale, 'reportCommand.topEventTypes', {
                                value: formatEventTypeCountList(report.topEventTypes, {
                                    locale: numberLocale,
                                    emptyText: t(locale, 'report.none'),
                                }),
                            }),
                            t(locale, 'reportCommand.topUsers', {
                                value: formatEntityCountList(report.topUsers, 'user', {
                                    locale: numberLocale,
                                    emptyText: t(locale, 'report.none'),
                                }),
                            }),
                        ].join('\n'),
                    },
                    ...(validatedEventType
                        ? [
                              {
                                  title: t(locale, 'reportCommand.sectionEventFocus'),
                                  body: [
                                      t(locale, 'reportCommand.selectedEventSummary', {
                                          eventType: validatedEventType,
                                          count: formatLocalizedNumber(
                                              report.totalLogs,
                                              numberLocale,
                                          ),
                                      }),
                                      t(locale, 'reportCommand.selectedEventPeakDate', {
                                          value: selectedEventPeakDateText,
                                      }),
                                      t(locale, 'reportCommand.selectedEventPeakCount', {
                                          count: formatLocalizedNumber(
                                              report.selectedEventPeakCount,
                                              numberLocale,
                                          ),
                                      }),
                                      t(locale, 'reportCommand.topUsers', {
                                          value: formatEntityCountList(report.topUsers, 'user', {
                                              locale: numberLocale,
                                              emptyText: t(locale, 'report.none'),
                                          }),
                                      }),
                                  ].join('\n'),
                              },
                          ]
                        : []),
                ],
                footer: t(locale, 'report.requester', { tag: interaction.user.tag }),
            }),
        );
    },
};

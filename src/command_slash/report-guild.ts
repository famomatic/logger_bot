import {
    SlashCommandBuilder,
    GuildPremiumTier,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';

import { buildContainerMessage } from '../commandShared/componentsV2.js';
import { parseDateString } from '../commandShared/logSearchShared.js';
import { isSuperAdmin } from '../commandShared/slashPermission.js';
import { config } from '../config/config.js';
import { getEventTypeChoices, isValidEventType } from '../config/eventsConfig.js';
import { isGuildAuthorized } from '../db/database.js';
import { getGuildReport } from '../db/logQueries.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';
import {
    formatEntityCountList,
    formatEventTypeCountList,
    formatLocalizedNumber,
    formatUserTagListFromIds,
} from '../utils/reportFormatters.js';

import type { ChatInputCommandInteraction } from 'discord.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('report-guild')
        .setDescription(defaultText('reportCommand.guildDescription'))
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
    permission: {
        public: true,
        listable: false,
    },
    async execute(interaction: ChatInputCommandInteraction) {
        const locale = getInteractionLocale(interaction);
        const numberLocale = locale === 'ko' ? 'ko-KR' : 'en-US';
        logger.info(`/report-guild command executed by ${interaction.user.tag}`);

        if (!interaction.inGuild()) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuild'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
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
                        content: t(locale, 'common.invalidEventType', {
                            eventType: eventTypeInput,
                        }),
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                validatedEventType = eventTypeInput;
            }

            const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;
            await interaction.deferReply({
                flags: ephemeral
                    ? MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
                    : MessageFlags.IsComponentsV2,
            });

            const guild = interaction.guild!;
            const authorized = isGuildAuthorized(guild.id);
            const report = await getGuildReport(guild.id, {
                startDate,
                endDate,
                eventType: validatedEventType,
            });
            const owner = await guild.fetchOwner().catch(() => null);
            const guildIconUrl = guild.iconURL({ size: 1024, forceStatic: false }) ?? undefined;
            const guildBannerUrl = guild.bannerURL({ size: 1024, forceStatic: false }) ?? undefined;

            const superAdminList = await formatUserTagListFromIds(
                interaction.client,
                config.superAdminIds,
                { emptyText: t(locale, 'report.none') },
            );
            const requesterIsSuperAdmin = isSuperAdmin(interaction.user.id);

            const premiumTierName = GuildPremiumTier[guild.premiumTier];
            const periodText =
                startDate && endDate
                    ? `<t:${Math.floor(startDate.getTime() / 1000)}:D> ~ <t:${Math.floor(endDate.getTime() / 1000)}:D>`
                    : t(locale, 'reportCommand.filterAny');
            const eventText = validatedEventType ?? t(locale, 'reportCommand.filterAny');
            const selectedEventPeakDateText =
                report.selectedEventPeakDate === null
                    ? t(locale, 'report.recordsNone')
                    : `<t:${Math.floor(report.selectedEventPeakDate.getTime() / 1000)}:D>`;

            const infoLines = [
                `**ID:** ${guild.id}`,
                t(locale, 'reportCommand.owner', {
                    owner: owner
                        ? `${owner.user.tag} (${owner.id})`
                        : t(locale, 'reportCommand.noOwner'),
                }),
                t(locale, 'reportCommand.createdAt', {
                    value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                }),
                t(locale, 'reportCommand.memberCount', {
                    value: formatLocalizedNumber(guild.memberCount, numberLocale),
                }),
                t(locale, 'reportCommand.boostLevel', { value: premiumTierName }),
            ];

            const statsLines = [
                t(locale, 'reportCommand.authStatus', {
                    value: authorized
                        ? t(locale, 'reportCommand.authYes')
                        : t(locale, 'reportCommand.authNo'),
                }),
                t(locale, 'reportCommand.totalLogs', {
                    count: formatLocalizedNumber(report.totalLogs, numberLocale),
                }),
                t(locale, 'reportCommand.filterPeriod', { value: periodText }),
                t(locale, 'reportCommand.filterEvent', { value: eventText }),
                t(locale, 'reportCommand.msg3', {
                    create: formatLocalizedNumber(report.messageCreateCount, numberLocale),
                    update: formatLocalizedNumber(report.messageUpdateCount, numberLocale),
                    delete: formatLocalizedNumber(report.messageDeleteCount, numberLocale),
                }),
                t(locale, 'reportCommand.moderationGuild', {
                    count: formatLocalizedNumber(report.moderationActionCount, numberLocale),
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
            ];

            const trendText =
                report.trendPercent === null
                    ? t(locale, 'report.trendNew')
                    : `${report.trendPercent > 0 ? '+' : ''}${report.trendPercent}%`;
            const anomalyLines = [
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
                t(locale, 'reportCommand.topChannels', {
                    value: formatEntityCountList(report.topChannels, 'channel', {
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
            ];

            const accessLines = [
                requesterIsSuperAdmin
                    ? t(locale, 'reportCommand.superAdmins', { value: superAdminList })
                    : t(locale, 'reportCommand.superAdmins', {
                          value: t(locale, 'common.commandNotAllowed'),
                      }),
            ];
            const eventFocusLines = validatedEventType
                ? [
                      t(locale, 'reportCommand.selectedEventSummary', {
                          eventType: validatedEventType,
                          count: formatLocalizedNumber(report.totalLogs, numberLocale),
                      }),
                      t(locale, 'reportCommand.selectedEventPeakDate', {
                          value: selectedEventPeakDateText,
                      }),
                      t(locale, 'reportCommand.selectedEventPeakCount', {
                          count: formatLocalizedNumber(report.selectedEventPeakCount, numberLocale),
                      }),
                      t(locale, 'reportCommand.topUsers', {
                          value: formatEntityCountList(report.topUsers, 'user', {
                              locale: numberLocale,
                              emptyText: t(locale, 'report.none'),
                          }),
                      }),
                      t(locale, 'reportCommand.topChannels', {
                          value: formatEntityCountList(report.topChannels, 'channel', {
                              locale: numberLocale,
                              emptyText: t(locale, 'report.none'),
                          }),
                      }),
                  ]
                : [];

            await interaction.editReply(
                buildContainerMessage({
                    title: t(locale, 'reportCommand.guildTitle', { guildName: guild.name }),
                    description: t(locale, 'reportCommand.guildDescriptionLine', {
                        guildName: guild.name,
                        guildId: guild.id,
                    }),
                    mediaGalleryItems: [
                        ...(guildIconUrl
                            ? [
                                  {
                                      url: guildIconUrl,
                                      description: t(locale, 'reportCommand.guildIcon', {
                                          guildName: guild.name,
                                      }),
                                  },
                              ]
                            : []),
                        ...(guildBannerUrl
                            ? [
                                  {
                                      url: guildBannerUrl,
                                      description: t(locale, 'reportCommand.guildBanner', {
                                          guildName: guild.name,
                                      }),
                                  },
                              ]
                            : []),
                    ],
                    accentColor: authorized ? 0x57f287 : 0xfee75c,
                    sections: [
                        {
                            title: t(locale, 'reportCommand.sectionBasic'),
                            body: infoLines.join('\n'),
                        },
                        {
                            title: t(locale, 'reportCommand.sectionSummary'),
                            body: statsLines.join('\n'),
                        },
                        {
                            title: t(locale, 'reportCommand.sectionTrend'),
                            body: anomalyLines.join('\n'),
                        },
                        {
                            title: t(locale, 'reportCommand.sectionAccess'),
                            body: accessLines.join('\n'),
                        },
                        ...(validatedEventType
                            ? [
                                  {
                                      title: t(locale, 'reportCommand.sectionEventFocus'),
                                      body: eventFocusLines.join('\n'),
                                  },
                              ]
                            : []),
                    ],
                    footer: t(locale, 'report.requester', { tag: interaction.user.tag }),
                }),
            );
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error('Error executing /report-guild command:', err);
            const errorMessage = err.message || t(locale, 'common.unknownError');
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    ...buildContainerMessage({
                        title: t(locale, 'reportCommand.errorTitle'),
                        description: t(locale, 'reportCommand.loadFailed', { error: errorMessage }),
                        accentColor: 0xed4245,
                    }),
                });
            } else {
                await interaction.reply({
                    content: t(locale, 'reportCommand.loadFailed', { error: errorMessage }),
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    },
};

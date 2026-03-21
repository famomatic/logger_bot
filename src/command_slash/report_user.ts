import { SlashCommandBuilder, MessageFlags, InteractionContextType } from 'discord.js';

import { buildContainerMessage } from '../commandShared/componentsV2.js';
import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { getUserReport } from '../db/logQueries.js';
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
        .setName('report-user')
        .setDescription(defaultText('reportCommand.userDescription'))
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription(defaultText('reportCommand.user'))
                .setRequired(true),
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

        const user = interaction.options.getUser('user', true);
        logger.info(`/report-user command executed by ${interaction.user.tag} for ${user.id}`);

        const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;
        await interaction.deferReply({
            flags: ephemeral
                ? MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
                : MessageFlags.IsComponentsV2,
        });

        const report = await getUserReport(interaction.guildId, user.id);
        const trendText =
            report.trendPercent === null
                ? t(locale, 'report.trendNew')
                : `${report.trendPercent > 0 ? '+' : ''}${report.trendPercent}%`;

        await interaction.editReply(
            buildContainerMessage({
                title: t(locale, 'reportCommand.userTitle'),
                description: t(locale, 'reportCommand.userDescriptionLine', { userId: user.id }),
                accentColor: 0x57f287,
                sections: [
                    {
                        title: t(locale, 'reportCommand.sectionCore'),
                        body: [
                            t(locale, 'reportCommand.totalLogs', {
                                count: formatLocalizedNumber(report.totalLogs, numberLocale),
                            }),
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
                            t(locale, 'reportCommand.topChannels', {
                                value: formatEntityCountList(report.topChannels, 'channel', {
                                    locale: numberLocale,
                                    emptyText: t(locale, 'report.none'),
                                }),
                            }),
                        ].join('\n'),
                    },
                ],
                footer: t(locale, 'report.requester', { tag: interaction.user.tag }),
            }),
        );
    },
};

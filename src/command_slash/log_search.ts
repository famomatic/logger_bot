import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ComponentType,
    MessageComponentInteraction,
    MessageFlags,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { getEventTypeChoices, isValidEventType } from '../config/eventsConfig.js';
import { parseDateString, fetchAndDisplayLogs } from '../commandShared/logSearchShared.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('log-search')
        .setDescription(defaultText('logSearch.description'))
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription(defaultText('logSearch.optUser'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('channel')
                .setDescription(defaultText('logSearch.optChannel'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('start-date')
                .setDescription(defaultText('logSearch.optStartDate'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('end-date')
                .setDescription(defaultText('logSearch.optEndDate'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('event-type')
                .setDescription(defaultText('logSearch.optEventType'))
                .setRequired(false)
                .addChoices(...getEventTypeChoices()),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const locale = getInteractionLocale(interaction);
        if (!interaction.guildId) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuildStrict'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (!(await ensureSlashCommandPermission(interaction))) {
            return;
        }

        logger.info(`'/log-search' command executed by ${interaction.user.tag}`);

        if (!interaction.deferred) {
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            });
        }

        const targetUser = interaction.options.getUser('user');
        const targetChannelIdInput = interaction.options.getString('channel');
        let targetChannelId: string | undefined = undefined;
        if (targetChannelIdInput) {
            const trimmed = targetChannelIdInput.trim();
            const isSnowflake = /^\d{17,20}$/.test(trimmed);
            if (!isSnowflake) {
                await interaction.editReply({
                    content: t(locale, 'common.invalidChannelIdInput'),
                    embeds: [],
                    components: [],
                });
                return;
            }
            targetChannelId = trimmed;
        }
        const startDateString = interaction.options.getString('start-date');
        const endDateString = interaction.options.getString('end-date');
        const rawEventType = interaction.options.getString('event-type');

        let validatedEventType: string | undefined = undefined;
        if (rawEventType) {
            if (isValidEventType(rawEventType)) {
                validatedEventType = rawEventType;
            } else {
                await interaction.editReply({
                    content: t(locale, 'logSearch.invalidEventTypeDetailed', {
                        eventType: rawEventType,
                    }),
                    embeds: [],
                    components: [],
                });
                return;
            }
        }

        const noOptionsProvidedInitially =
            !targetUser &&
            !targetChannelId &&
            !startDateString &&
            !endDateString &&
            !validatedEventType;

        let startDate: Date | undefined = undefined;
        let endDate: Date | undefined = undefined;

        if (startDateString) {
            const parsed = parseDateString(startDateString, false);
            if (!parsed) {
                await interaction.editReply({
                    content: t(locale, 'common.invalidStartDate'),
                    embeds: [],
                    components: [],
                });
                return;
            }
            startDate = parsed;
        }
        if (endDateString) {
            const parsed = parseDateString(endDateString, true);
            if (!parsed) {
                await interaction.editReply({
                    content: t(locale, 'common.invalidEndDate'),
                    embeds: [],
                    components: [],
                });
                return;
            }
            endDate = parsed;
        }
        if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
            await interaction.editReply({
                content: t(locale, 'common.startAfterEnd'),
                embeds: [],
                components: [],
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

        const initialSearchParams = {
            guildId: interaction.guildId,
            userId: targetUser?.id,
            channelId: targetChannelId,
            startDate,
            endDate,
            eventType: validatedEventType,
            noOptionsProvidedInitially,
        };

        await fetchAndDisplayLogs(interaction, 0, initialSearchParams, false, 0);

        try {
            const message = await interaction.fetchReply();
            const collector = message.createMessageComponentCollector({
                filter: (i: MessageComponentInteraction) =>
                    i.customId.startsWith('log_search_') && i.user.id === interaction.user.id,
                componentType: ComponentType.Button,
                time: 15 * 60 * 1000,
            });

            collector?.on('collect', (i: MessageComponentInteraction) => {
                void (async () => {
                    if (!i.isButton()) return;

                    await i.deferUpdate();

                    const customIdParts = i.customId.split('_');
                    const action = customIdParts[2];
                    const newOffset = parseInt(customIdParts[3], 10);
                    const newPage = parseInt(customIdParts[4], 10);

                    if (
                        (action === 'prev' || action === 'next') &&
                        !isNaN(newOffset) &&
                        !isNaN(newPage)
                    ) {
                        await fetchAndDisplayLogs(
                            i,
                            newOffset,
                            initialSearchParams,
                            false,
                            newPage,
                        );
                    } else if (action !== 'pageinfo') {
                        logger.warn(`Unknown button action or invalid offset: ${i.customId}`);
                    }
                })();
            });
        } catch (fetchReplyError) {
            logger.error('Failed to fetch reply for collector setup:', fetchReplyError);
        }
    },
};

import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    ComponentType,
    MessageComponentInteraction,
    MessageFlags,
    PermissionsBitField,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import { getEventTypeChoices, isValidEventType } from '../config/eventsConfig.js';
import { parseDateString, fetchAndDisplayLogs } from '../commandShared/logSearchShared.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('log-search')
        .setDescription(
            '데이터베이스에서 메시지 로그를 검색합니다. 옵션 없이 실행 시 최신 로그를 보여줍니다.',
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
        .addUserOption((option) =>
            option.setName('user').setDescription('검색할 사용자를 지정하세요.').setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('channel')
                .setDescription('검색할 채널 ID를 입력하세요. (삭제된 채널도 가능)')
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('start-date')
                .setDescription('검색 시작일 (YYYY-MM-DD) (예: 2023-01-01)')
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('end-date')
                .setDescription('검색 종료일 (YYYY-MM-DD) (예: 2023-01-31)')
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('event-type')
                .setDescription(
                    '검색할 이벤트 유형을 선택하거나 직접 입력하세요. (예: messageCreate)',
                )
                .setRequired(false)
                .addChoices(...getEventTypeChoices()),
        ),
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
                    content: '오류: 채널은 ID로 입력해주세요. (예: 123456789012345678)',
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
                    content: `오류: 유효하지 않은 이벤트 유형입니다: \`${rawEventType}\`. 올바른 이벤트 타입을 입력하거나 선택해주세요.`,
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
                    content:
                        '오류: 유효하지 않은 시작 날짜 형식입니다. YYYY-MM-DD 형식으로 입력해주세요.',
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
                    content:
                        '오류: 유효하지 않은 종료 날짜 형식입니다. YYYY-MM-DD 형식으로 입력해주세요.',
                    embeds: [],
                    components: [],
                });
                return;
            }
            endDate = parsed;
        }
        if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
            await interaction.editReply({
                content: '오류: 검색 시작일이 종료일보다 늦을 수 없습니다.',
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

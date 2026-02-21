import type { LegacyCommand } from '../types/commands.js';
import {
    Message,
    PermissionsBitField,
    ComponentType,
    ChatInputCommandInteraction,
    InteractionEditReplyOptions,
    MessagePayload,
    MessageFlags,
    TextDisplayBuilder,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import { isValidEventType } from '../config/eventsConfig.js';
import { parseDateString, fetchAndDisplayLogs } from '../commandShared/logSearchShared.js';

function parseArgs(content: string) {
    const args: Record<string, string> = {};
    const regex = /--(user|channel|start-date|end-date|event-type)=([\S]+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        args[match[1]] = match[2];
    }
    return args;
}

const command: LegacyCommand = {
    name: 'log-search',
    async execute(message: Message) {
        const memberPermissions = message.member?.permissions;
        const devLevel = config.getDevLevel(message.author.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);

        if (!message.guildId) {
            await message.reply({ content: '이 명령어는 서버 내에서만 사용할 수 있습니다.' });
            return;
        }

        if (devLevel < 2 && !isAdmin) {
            await message.reply('이 명령어는 레벨2 이상 개발자 또는 관리자만 사용할 수 있습니다.');
            return;
        }

        const args = parseArgs(message.content);
        const userId = args.user;
        const channelId = args.channel;
        const startDateString = args['start-date'];
        const endDateString = args['end-date'];
        const rawEventType = args['event-type'];

        let eventType: string | undefined;
        if (rawEventType) {
            if (!isValidEventType(rawEventType)) {
                await message.reply({
                    content: `오류: 유효하지 않은 이벤트 유형입니다: \`${rawEventType}\`. 올바른 이벤트 타입을 입력해주세요.`,
                });
                return;
            }
            eventType = rawEventType;
        }

        let startDate: Date | undefined = undefined;
        let endDate: Date | undefined = undefined;

        if (startDateString) {
            const parsed = parseDateString(startDateString, false);
            if (!parsed) {
                await message.reply({
                    content:
                        '오류: 유효하지 않은 시작 날짜 형식입니다. YYYY-MM-DD 형식으로 입력해주세요.',
                });
                return;
            }
            startDate = parsed;
        }

        if (endDateString) {
            const parsed = parseDateString(endDateString, true);
            if (!parsed) {
                await message.reply({
                    content:
                        '오류: 유효하지 않은 종료 날짜 형식입니다. YYYY-MM-DD 형식으로 입력해주세요.',
                });
                return;
            }
            endDate = parsed;
        }

        if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
            await message.reply({
                content: '오류: 검색 시작일이 종료일보다 늦을 수 없습니다.',
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

        const noOptionsProvidedInitially =
            !userId && !channelId && !startDateString && !endDateString && !eventType;

        const reply = await message.reply('검색 중입니다...');

        const pseudoInteraction = {
            client: message.client,
            user: message.author,
            guild: message.guild,
            guildId: message.guildId,
            replied: true,
            deferred: false,
            fetchReply: () => Promise.resolve(reply),
            editReply: (options: string | MessagePayload | InteractionEditReplyOptions) =>
                reply.edit(options),
        } as ChatInputCommandInteraction;

        const initialParams = {
            guildId: message.guildId,
            userId,
            channelId,
            startDate,
            endDate,
            eventType,
            noOptionsProvidedInitially,
        };

        await fetchAndDisplayLogs(pseudoInteraction, 0, initialParams, true, 0);

        try {
            const collector = reply.createMessageComponentCollector({
                filter: (i) => i.customId.startsWith('log_search_') && i.user.id === message.author.id,
                componentType: ComponentType.Button,
                time: 15 * 60 * 1000,
            });

            collector.on('collect', (i) => {
                void (async () => {
                    if (!i.isButton()) return;

                    if (i.customId === 'log_search_close') {
                        await i.update({
                            flags: MessageFlags.IsComponentsV2,
                            components: [new TextDisplayBuilder().setContent('이 메시지는 곧 삭제됩니다.')],
                            embeds: [],
                            files: [],
                        });
                        await reply.delete().catch(() => {
                            /* empty */
                        });
                        collector.stop();
                        return;
                    }

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
                        await fetchAndDisplayLogs(i, newOffset, initialParams, true, newPage);
                    } else if (action !== 'pageinfo') {
                        logger.warn(`Unknown button action or invalid offset: ${i.customId}`);
                    }
                })().catch((err) => logger.error('Error in collector:', err));
            });
        } catch (fetchReplyError) {
            logger.error('Failed to fetch reply for collector setup:', fetchReplyError);
        }
    },
};

export { command };

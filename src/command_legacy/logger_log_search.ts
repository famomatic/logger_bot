import { LegacyCommand } from '../utils/loadLegacyCommands.js';
import {
    Message,
    PermissionsBitField,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ComponentType,
    ChatInputCommandInteraction,
    MessageActionRowComponentBuilder,
    InteractionReplyOptions,
    InteractionEditReplyOptions,
    MessagePayload,
    ChannelType,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SectionBuilder,
    SeparatorBuilder,
    FileBuilder,
    AttachmentBuilder,
    MessageComponentInteraction,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import { eventConfigurations } from '../config/eventsConfig.js';

interface AttachmentLogData {
    id: string;
    filename: string;
    webdavPath?: string;
    discordUrl?: string;
}
import { searchLogs } from '../db/database.js';
import { storageManager } from '../storage/StorageManager.js';
import { escapeCodeBlockContent } from '../utils/sanitize.js';

const PAGE_SIZE = 5; // 페이지당 로그 수
interface JsonData {
    [key: string]: JsonData | string | number | boolean | null | undefined | JsonData[];
}

function str(
    val: JsonData | string | number | boolean | null | undefined | JsonData[],
    fallback = '',
): string {
    if (val == null) return fallback;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return JSON.stringify(val);
}

function num(
    val: JsonData | string | number | boolean | null | undefined | JsonData[],
    fallback = 0,
): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const n = Number(val);
        return isNaN(n) ? fallback : n;
    }
    return fallback;
}

const STICKER_FORMAT_LABELS: Record<number, string> = {
    1: 'PNG',
    2: 'APNG',
    3: 'LOTTIE',
    4: 'GIF',
};

function formatStickerSummary(sticker: JsonData, index: number): string {
    if (!sticker || typeof sticker !== 'object') {
        return `${index + 1}. 알 수 없는 스티커`;
    }

    const parts: string[] = [];
    const name = str(sticker.name, '이름 없음');
    parts.push(`${index + 1}. ${name}`);

    const metadata: string[] = [];
    const id = str(sticker.id);
    if (id) {
        metadata.push(`ID ${id}`);
    }

    let formatLabel: string | undefined;
    const format = num(sticker.format);
    const formatType = num(sticker.format_type);

    if (format !== 0) {
        formatLabel = STICKER_FORMAT_LABELS[format] || `형식 ${format}`;
    } else if (formatType !== 0) {
        formatLabel = STICKER_FORMAT_LABELS[formatType] || `형식 ${formatType}`;
    } else if (typeof sticker.format === 'string') {
        formatLabel = sticker.format;
    }

    if (formatLabel) {
        metadata.push(formatLabel);
    }

    if (metadata.length > 0) {
        parts.push(`(${metadata.join(', ')})`);
    }

    return parts.join(' ');
}

// 날짜 문자열(YYYY-MM-DD)을 Date 객체로 변환하는 헬퍼 함수
function parseDateString(dateString: string, isEndDate = false): Date | null {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (!parts) return null;

    const year = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1; // Month is 0-indexed
    const day = parseInt(parts[3], 10);

    const date = new Date(Date.UTC(year, month, day));

    if (isNaN(date.getTime())) return null;
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    if (isEndDate) {
        date.setUTCHours(23, 59, 59, 999);
    } else {
        date.setUTCHours(0, 0, 0, 0);
    }
    return date;
}

// 로그를 가져와서 컴포넌트 V2와 버튼으로 표시하는 함수
async function fetchAndDisplayLogs(
    interaction: ChatInputCommandInteraction | MessageComponentInteraction,
    currentOffset: number,
    searchParams: {
        // 검색 조건을 담는 객체
        guildId: string;
        userId?: string;
        channelId?: string;
        startDate?: Date;
        endDate?: Date;
        eventType?: string;
        noOptionsProvidedInitially: boolean;
    },
    includeCloseButton = false,
    currentPage: number = Math.floor(currentOffset / PAGE_SIZE),
) {
    const {
        guildId,
        userId,
        channelId,
        startDate,
        endDate,
        eventType,
        noOptionsProvidedInitially,
    } = searchParams;

    try {
        const { logs, totalCount } = await searchLogs({
            guildId: guildId,
            userId: userId,
            channelId: channelId,
            startDate: startDate,
            endDate: endDate,
            eventType: eventType,
            limit: PAGE_SIZE,
            offset: currentOffset,
        });

        const editReplyOptions: InteractionEditReplyOptions = {
            content: null,
            embeds: [],
            components: [],
            files: [],
            allowedMentions: { parse: [] }, // Disable all forms of parsing mentions
        };

        if (totalCount === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle(
                    noOptionsProvidedInitially && currentOffset === 0
                        ? '최근 로그 없음'
                        : '검색 결과 없음',
                )
                .setDescription(
                    noOptionsProvidedInitially && currentOffset === 0
                        ? '이 서버에 기록된 최근 로그가 없습니다.'
                        : '지정된 조건으로 검색된 로그가 없습니다.',
                );
            editReplyOptions.embeds = [embed];
            await interaction.editReply(editReplyOptions);
            return;
        }

        // 디스플레이용 컴포넌트들 (ActionRow로 감싸지 않음)
        const displayableComponents: (
            | TextDisplayBuilder
            | SectionBuilder
            | SeparatorBuilder
            | FileBuilder
        )[] = [];
        const attachmentsToSend: AttachmentBuilder[] = [];

        // Create a TextDisplayBuilder for the summary message (formerly content)
        const summaryMessage =
            noOptionsProvidedInitially && currentOffset === 0 && totalCount > 0
                ? `최근 로그 (${totalCount}개 중 ${logs.length}개 표시)`
                : `검색 결과 (${totalCount}개 중 ${logs.length}개 표시)`;
        const summaryBuilder = new TextDisplayBuilder().setContent(summaryMessage);
        displayableComponents.push(summaryBuilder);
        displayableComponents.push(new SeparatorBuilder()); // Add a separator after the summary

        const MAX_TEXT_SIZE = 3900;
        let currentTextSize = summaryMessage.length;
        let logsDisplayed = 0;

        for (const log of logs) {
            let thumbnailComponent;
            try {
                const logUser = log.user_id
                    ? await interaction.client.users.fetch(log.user_id)
                    : null;
                thumbnailComponent = new ThumbnailBuilder({
                    media: {
                        url:
                            logUser?.displayAvatarURL({ forceStatic: false, size: 64 }) ??
                            `https://cdn.discordapp.com/embed/avatars/${parseInt(log.user_id ?? '0') % 5}.png`,
                    },
                });
            } catch {
                thumbnailComponent = new ThumbnailBuilder({
                    media: { url: `https://cdn.discordapp.com/embed/avatars/0.png` },
                });
            }

            const timestampContent = `<t:${Math.floor(new Date(log.timestamp).getTime() / 1000)}:F>`;
            const timestampText = new TextDisplayBuilder().setContent(timestampContent);
            let eventSpecificsText = '(내용 없음)';

            if (log.event_data && typeof log.event_data === 'object') {
                const data = log.event_data as JsonData;
                switch (log.event_type) {
                    case 'messageCreate':
                    case 'messageDelete': {
                        const messageParts: string[] = [];
                        const content = str(data.content);
                        if (content.trim().length > 0) {
                            messageParts.push(`\`\`\`${escapeCodeBlockContent(content)}\`\`\``);
                        }

                        const stickers = Array.isArray(data.stickers) ? data.stickers : [];
                        if (stickers.length > 0) {
                            const stickerSummaries = stickers.map((sticker, index: number) =>
                                formatStickerSummary(sticker, index),
                            );
                            messageParts.push(`스티커:\n${stickerSummaries.join('\n')}`);
                        }

                        eventSpecificsText =
                            messageParts.length > 0 ? messageParts.join('\n\n') : '(내용 없음)';
                        break;
                    }
                    case 'messageUpdate': {
                        const oldContent = str(data.oldContent);
                        const newContent = str(data.newContent);
                        if (newContent && oldContent) {
                            const oldContentPreview =
                                oldContent.length > 100
                                    ? `${oldContent.substring(0, 100)}...`
                                    : oldContent;
                            eventSpecificsText = `현재: \`\`\`${escapeCodeBlockContent(newContent)}\`\`\`\n이전: \`\`\`${escapeCodeBlockContent(oldContentPreview)}\`\`\``;
                        } else if (newContent) {
                            eventSpecificsText = `\`\`\`${escapeCodeBlockContent(newContent)}\`\`\``;
                        } else if (oldContent) {
                            eventSpecificsText = `이전: \`\`\`${escapeCodeBlockContent(oldContent)}\`\`\``;
                        } else {
                            eventSpecificsText = '(내용 없음)';
                        }
                        break;
                    }
                    case 'guildMemberAdd': {
                        const memberAddDetails: string[] = [];
                        const memberTag = str(data.memberTag);
                        const memberId = str(data.memberId);
                        if (memberTag)
                            memberAddDetails.push(
                                `**사용자:** ${memberTag} (${memberId || 'ID 없음'})`,
                            );

                        const member = data.member as JsonData;
                        const user = data.user as JsonData;

                        const accountAge =
                            num(member?.createdTimestamp) || num(user?.createdTimestamp);
                        if (accountAge) {
                            memberAddDetails.push(
                                `**계정 생성일:** <t:${Math.floor(accountAge / 1000)}:R>`,
                            );
                        }
                        eventSpecificsText =
                            memberAddDetails.length > 0
                                ? memberAddDetails.join('\n')
                                : '(내용 없음)';
                        break;
                    }
                    case 'guildMemberRemove': {
                        const memberRemoveDetails: string[] = [];
                        const memberTag = str(data.memberTag);
                        const memberId = str(data.memberId);
                        if (memberTag)
                            memberRemoveDetails.push(
                                `**사용자:** ${memberTag} (${memberId || 'ID 없음'})`,
                            );

                        const member = data.member as JsonData;
                        // const user = data.user as JsonData; // user is unused

                        const joinedAt = num(member?.joinedTimestamp);
                        if (joinedAt) {
                            memberRemoveDetails.push(
                                `**가입일:** <t:${Math.floor(joinedAt / 1000)}:R>`,
                            );
                        }

                        const roles = Array.isArray(member?.roles) ? member.roles : [];
                        if (roles.length > 0) {
                            memberRemoveDetails.push(`**역할:** ${roles.length}개`);
                        }

                        eventSpecificsText =
                            memberRemoveDetails.length > 0
                                ? memberRemoveDetails.join('\n')
                                : '(내용 없음)';
                        break;
                    }

                    case 'guildMemberUpdate': {
                        const memberUpdateDetails: string[] = [];
                        const member = data.member as JsonData;
                        const user = data.user as JsonData;

                        // 닉네임 변경 확인
                        const oldNick = str((data.oldMember as JsonData)?.nickname);
                        const newNick = str((data.newMember as JsonData)?.nickname);
                        if (oldNick !== newNick) {
                            memberUpdateDetails.push(
                                `**닉네임:** ${oldNick || '(없음)'} -> ${newNick || '(없음)'}`,
                            );
                        }

                        // 역할 변경 확인
                        const oldRolesData = (data.oldMember as JsonData)?.roles;
                        const newRolesData = (data.newMember as JsonData)?.roles;
                        const oldRoles = Array.isArray(oldRolesData)
                            ? (oldRolesData as unknown[]).filter((r) => typeof r === 'string')
                            : [];
                        const newRoles = Array.isArray(newRolesData)
                            ? (newRolesData as unknown[]).filter((r) => typeof r === 'string')
                            : [];

                        const addedRoles = newRoles.filter((r) => !oldRoles.includes(r));
                        const removedRoles = oldRoles.filter((r) => !newRoles.includes(r));

                        if (addedRoles.length > 0)
                            memberUpdateDetails.push(`**역할 추가:** ${addedRoles.length}개`);
                        if (removedRoles.length > 0)
                            memberUpdateDetails.push(`**역할 제거:** ${removedRoles.length}개`);

                        // 사용자 태그 fallback
                        const updatedMember =
                            member ??
                            (log.user_id
                                ? { id: log.user_id, tag: str(user?.tag, `<@${log.user_id}>`) }
                                : null);

                        if (updatedMember) {
                            const tag = str(updatedMember.tag);
                            const id = str(updatedMember.id);
                            memberUpdateDetails.unshift(
                                `**대상:** ${tag || '알 수 없음'} (${id || 'ID 없음'})`,
                            );
                        }

                        eventSpecificsText =
                            memberUpdateDetails.length > 0
                                ? memberUpdateDetails.join('\n')
                                : '(내용 없음)';
                        break;
                    }

                    case 'guildRoleCreate':
                    case 'guildRoleUpdate':
                    case 'guildRoleDelete': {
                        const role = data.role as JsonData;
                        const roleName = str(role?.name, '알 수 없는 역할');
                        const roleId = str(role?.id, 'ID 없음');
                        eventSpecificsText = `**역할:** ${roleName} (${roleId})`;

                        if (log.event_type === 'guildRoleUpdate') {
                            const oldRole = data.oldRole as JsonData;
                            const newRole = data.newRole as JsonData;

                            const oldName = str(oldRole?.name);
                            const newName = str(newRole?.name);
                            if (oldName && newName && oldName !== newName) {
                                eventSpecificsText += `\n**이름 변경:** ${oldName} -> ${newName}`;
                            }

                            // 권한 변경 등 추가 가능
                        }
                        break;
                    }

                    // STICKER EVENTS
                    case 'stickerCreate': {
                        const stickerDetails: string[] = [];
                        const sticker = (data.sticker ?? data) as JsonData;
                        const id = str(sticker?.id);
                        if (id) {
                            stickerDetails.push(`**스티커 이름:** ${str(sticker.name, 'N/A')}`);
                            stickerDetails.push(`**ID:** ${id}`);
                            const tags = sticker.tags;
                            const tagStr = Array.isArray(tags)
                                ? tags.map((t) => str(t)).join(', ')
                                : str(tags);
                            if (tagStr) stickerDetails.push(`**태그:** ${tagStr}`);

                            const desc = str(sticker.description);
                            if (desc) stickerDetails.push(`**설명:** ${desc}`);

                            const formatType = num(sticker.format_type);
                            if (formatType) {
                                // format_type can be 0, but usually 1-4
                                const formatTypes: Record<number, string> = {
                                    1: 'PNG',
                                    2: 'APNG',
                                    3: 'LOTTIE',
                                    4: 'GIF',
                                };
                                stickerDetails.push(
                                    `**포맷:** ${formatTypes[formatType] ?? `알 수 없는 포맷 (${formatType})`}`,
                                );
                            }
                            const guildId = str(sticker.guildId);
                            if (guildId) stickerDetails.push(`**서버 ID:** ${guildId}`);
                        }
                        eventSpecificsText =
                            stickerDetails.length > 0 ? stickerDetails.join('\n') : '(내용 없음)';

                        if (id && num(sticker.format_type) !== 3) {
                            try {
                                const fetchedSticker = await interaction.guild?.stickers.fetch(id);
                                if (fetchedSticker?.url) {
                                    thumbnailComponent = new ThumbnailBuilder({
                                        media: { url: fetchedSticker.url },
                                    });
                                }
                            } catch {
                                /* empty */
                            }
                        }
                        if (!thumbnailComponent && log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executorUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'stickerUpdate': {
                        const stickerDetails: string[] = [];
                        const oldSticker = data.oldSticker as JsonData;
                        const newSticker = (data.newSticker ?? data.sticker) as JsonData;
                        const newId = str(newSticker?.id);

                        if (newId) {
                            stickerDetails.push(
                                `**스티커:** ${str(newSticker.name, 'N/A')} (ID: ${newId})`,
                            );
                            if (oldSticker) {
                                const oldName = str(oldSticker.name);
                                const newName = str(newSticker.name);
                                if (oldName !== newName)
                                    stickerDetails.push(
                                        `**이름 변경:** \`\`\`${oldName}\`\`\` -> \`\`\`${newName}\`\`\``,
                                    );

                                const oldDesc = str(oldSticker.description);
                                const newDesc = str(newSticker.description);
                                if (oldDesc !== newDesc)
                                    stickerDetails.push(
                                        `**설명 변경:** \`\`\`${oldDesc || '(없음)'}\`\`\` -> \`\`\`${newDesc || '(없음)'}\`\`\``,
                                    );

                                const oldTags = oldSticker.tags;
                                const newTags = newSticker.tags;
                                const oldTagsStr = Array.isArray(oldTags)
                                    ? oldTags.map((t) => str(t)).join(', ')
                                    : str(oldTags);
                                const newTagsStr = Array.isArray(newTags)
                                    ? newTags.map((t) => str(t)).join(', ')
                                    : str(newTags);

                                if (oldTagsStr !== newTagsStr)
                                    stickerDetails.push(
                                        `**태그 변경:** \`\`\`${oldTagsStr || '(없음)'}\`\`\` -> \`\`\`${newTagsStr || '(없음)'}\`\`\``,
                                    );
                            } else {
                                stickerDetails.push('(이전 스티커 정보 없음, 새 정보만 표시)');
                                const desc = str(newSticker.description);
                                if (desc) stickerDetails.push(`**설명:** ${desc}`);
                                const tags = newSticker.tags;
                                const tagStr = Array.isArray(tags)
                                    ? tags.map((t) => str(t)).join(', ')
                                    : str(tags);
                                if (tagStr) stickerDetails.push(`**태그:** ${tagStr}`);
                            }
                        } else {
                            stickerDetails.push('(스티커 정보 없음)');
                        }
                        eventSpecificsText =
                            stickerDetails.length > 0 ? stickerDetails.join('\n') : '(내용 없음)';

                        if (newId && num(newSticker.format_type) !== 3) {
                            try {
                                const fetchedSticker =
                                    await interaction.guild?.stickers.fetch(newId);
                                if (fetchedSticker?.url) {
                                    thumbnailComponent = new ThumbnailBuilder({
                                        media: { url: fetchedSticker.url },
                                    });
                                }
                            } catch {
                                /* empty */
                            }
                        }
                        if (!thumbnailComponent && log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executorUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'stickerDelete': {
                        const stickerDetails: string[] = [];
                        const sticker = (data.sticker ?? data) as JsonData;
                        const id = str(sticker?.id);
                        if (id) {
                            stickerDetails.push(
                                `**삭제된 스티커 이름:** ${str(sticker.name, 'N/A')}`,
                            );
                            stickerDetails.push(`**ID:** ${id}`);
                            const tags = sticker.tags;
                            const tagStr = Array.isArray(tags)
                                ? tags.map((t) => str(t)).join(', ')
                                : str(tags);
                            if (tagStr) stickerDetails.push(`**태그:** ${tagStr}`);
                        }
                        eventSpecificsText =
                            stickerDetails.length > 0 ? stickerDetails.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executorUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }

                    // EMOJI EVENTS
                    case 'emojiCreate': {
                        const emojiDetails: string[] = [];
                        const emoji = (data.emoji ?? data) as JsonData;
                        const id = str(emoji?.id);
                        if (id) {
                            const name = str(emoji.name, 'N/A');
                            emojiDetails.push(`**이모지 이름:** ${name}`);
                            emojiDetails.push(`**ID:** ${id}`);
                            emojiDetails.push(`**표시:** <:${name}:${id}>`);
                            if (emoji.animated) emojiDetails.push(`**애니메이션됨:** 예`);
                        }
                        eventSpecificsText =
                            emojiDetails.length > 0 ? emojiDetails.join('\n') : '(내용 없음)';
                        if (id) {
                            const ext = emoji.animated ? 'gif' : 'png';
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/emojis/${id}.${ext}?size=64`,
                                },
                            });
                        } else if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executorUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'emojiUpdate': {
                        const emojiDetails: string[] = [];
                        const oldEmoji = data.oldEmoji as JsonData;
                        const newEmoji = (data.newEmoji ?? data.emoji) as JsonData;
                        const newId = str(newEmoji?.id);

                        if (newId) {
                            const newName = str(newEmoji.name, 'N/A');
                            emojiDetails.push(
                                `**이모지:** ${newName} (ID: ${newId}) <:${newName}:${newId}>`,
                            );
                            if (oldEmoji) {
                                const oldName = str(oldEmoji.name);
                                if (oldName !== newName) {
                                    emojiDetails.push(
                                        `**이름 변경:** \`\`\`${oldName}\`\`\` -> \`\`\`${newName}\`\`\``,
                                    );
                                }
                            } else {
                                emojiDetails.push('(이전 이모지 정보 없음)');
                            }
                        } else {
                            emojiDetails.push('(이모지 정보 없음)');
                        }
                        eventSpecificsText =
                            emojiDetails.length > 0 ? emojiDetails.join('\n') : '(내용 없음)';
                        if (newId) {
                            const ext = newEmoji.animated ? 'gif' : 'png';
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/emojis/${newId}.${ext}?size=64`,
                                },
                            });
                        } else if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executorUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'emojiDelete': {
                        const emojiDetails: string[] = [];
                        const emoji = (data.emoji ?? data) as JsonData;
                        const id = str(emoji?.id);
                        if (id) {
                            emojiDetails.push(`**삭제된 이모지 이름:** ${str(emoji.name, 'N/A')}`);
                            emojiDetails.push(`**ID:** ${id}`);
                        }
                        eventSpecificsText =
                            emojiDetails.length > 0 ? emojiDetails.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executorUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }

                    // GUILD BAN EVENTS
                    case 'guildBanAdd': {
                        const banDetails: string[] = [];
                        const dataUser = data.user as JsonData;
                        const userId = str(data.userId);
                        const userTag = str(data.userTag);

                        const user = dataUser ?? (userId ? { id: userId, tag: userTag } : null);
                        const reason = str(data.reason);
                        const executor = data.executor as JsonData;

                        if (user) {
                            const uTag = str(user.tag);
                            const uId = str(user.id);
                            banDetails.push(`**사용자:** ${uTag || `<@${uId}>`} (${uId})`);
                        } else if (userId) {
                            banDetails.push(`**사용자 ID:** ${userId}`);
                        }

                        if (reason) {
                            const trimmedReason =
                                reason.length > 200 ? `${reason.substring(0, 200)}...` : reason;
                            banDetails.push(`**사유:** ${trimmedReason}`);
                        }

                        if (executor?.id) {
                            const eTag = str(executor.tag);
                            const eId = str(executor.id);
                            banDetails.push(`**실행자:** ${eTag || `<@${eId}>`} (${eId})`);
                        } else if (log.user_id && num(executor?.id) !== num(log.user_id)) {
                            try {
                                const execUser = await interaction.client.users.fetch(log.user_id);
                                banDetails.push(
                                    `**실행자 (로깅):** ${execUser.tag} (<@${log.user_id}>)`,
                                );
                            } catch {
                                banDetails.push(`**실행자 ID (로깅):** ${log.user_id}`);
                            }
                        }
                        eventSpecificsText =
                            banDetails.length > 0 ? banDetails.join('\n') : '(내용 없음)';

                        const uId = str(user?.id);
                        if (uId) {
                            try {
                                const bannedUser = await interaction.client.users.fetch(uId);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: bannedUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        } else if (executor?.id) {
                            try {
                                const execUser = await interaction.client.users.fetch(
                                    str(executor.id),
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: execUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'guildBanRemove': {
                        const unbanDetails: string[] = [];
                        const dataUser = data.user as JsonData;
                        const userId = str(data.userId);
                        const userTag = str(data.userTag);

                        const user = dataUser ?? (userId ? { id: userId, tag: userTag } : null);
                        const executor = data.executor as JsonData;

                        if (user) {
                            const uTag = str(user.tag);
                            const uId = str(user.id);
                            unbanDetails.push(`**사용자:** ${uTag || `<@${uId}>`} (${uId})`);
                        } else if (userId) {
                            unbanDetails.push(`**사용자 ID:** ${userId}`);
                        }

                        if (executor?.id) {
                            const eTag = str(executor.tag);
                            const eId = str(executor.id);
                            unbanDetails.push(`**실행자:** ${eTag || `<@${eId}>`} (${eId})`);
                        } else if (log.user_id && num(executor?.id) !== num(log.user_id)) {
                            try {
                                const execUser = await interaction.client.users.fetch(log.user_id);
                                unbanDetails.push(
                                    `**실행자 (로깅):** ${execUser.tag} (<@${log.user_id}>)`,
                                );
                            } catch {
                                unbanDetails.push(`**실행자 ID (로깅):** ${log.user_id}`);
                            }
                        }
                        eventSpecificsText =
                            unbanDetails.length > 0 ? unbanDetails.join('\n') : '(내용 없음)';

                        const uId = str(user?.id);
                        if (uId) {
                            try {
                                const unbannedUser = await interaction.client.users.fetch(uId);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: unbannedUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        } else if (executor?.id) {
                            try {
                                const execUser = await interaction.client.users.fetch(
                                    str(executor.id),
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: execUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }

                    // GUILD SCHEDULED EVENT
                    case 'guildScheduledEventCreate': {
                        const eventDetails: string[] = [];
                        const event = (data.scheduledEvent ?? data) as JsonData;
                        const id = str(event?.id);
                        if (event) {
                            eventDetails.push(`**이벤트 이름:** ${str(event.name, 'N/A')}`);
                            if (id) eventDetails.push(`**ID:** ${id}`);
                            const desc = str(event.description);
                            if (desc)
                                eventDetails.push(
                                    `**설명:** ${desc.substring(0, 100)}${desc.length > 100 ? '...' : ''}`,
                                );

                            const startTime = str(event.scheduledStartTime);
                            if (startTime)
                                eventDetails.push(
                                    `**시작 시간:** <t:${Math.floor(new Date(startTime).getTime() / 1000)}:F>`,
                                );
                            const endTime = str(event.scheduledEndTime);
                            if (endTime)
                                eventDetails.push(
                                    `**종료 시간:** <t:${Math.floor(new Date(endTime).getTime() / 1000)}:F>`,
                                );

                            const entityType = num(event.entityType);
                            if (entityType !== undefined) {
                                const types: Record<number, string> = {
                                    1: '스테이지',
                                    2: '음성 채널',
                                    3: '외부 링크',
                                };
                                eventDetails.push(
                                    `**유형:** ${types[entityType] || `알 수 없음 (${entityType})`}`,
                                );
                            }
                            const channelId = str(event.channelId);
                            if (channelId) eventDetails.push(`**채널:** <#${channelId}>`);
                            else {
                                const location = str((event.entityMetadata as JsonData)?.location);
                                if (location) eventDetails.push(`**위치:** ${location}`);
                            }

                            const creatorId = str(event.creatorId);
                            if (creatorId) {
                                try {
                                    const creator = await interaction.client.users.fetch(creatorId);
                                    eventDetails.push(
                                        `**생성자:** ${creator.tag} (<@${creatorId}>)`,
                                    );
                                } catch {
                                    eventDetails.push(`**생성자 ID:** ${creatorId}`);
                                }
                            }
                        }
                        eventSpecificsText =
                            eventDetails.length > 0 ? eventDetails.join('\n') : '(내용 없음)';

                        const image = str(event?.image);
                        const creatorId = str(event?.creatorId);

                        if (id && image) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/guild-events/${id}/${image}.png?size=64`,
                                },
                            });
                        } else if (creatorId) {
                            try {
                                const creator = await interaction.client.users.fetch(creatorId);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: creator.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'guildScheduledEventUpdate': {
                        const eventDetails: string[] = [];
                        const oldEvent = data.oldScheduledEvent as JsonData;
                        const newEvent = (data.newScheduledEvent ??
                            data.scheduledEvent) as JsonData;
                        const newId = str(newEvent?.id);

                        if (newId) {
                            eventDetails.push(
                                `**이벤트:** ${str(newEvent.name, 'N/A')} (ID: ${newId})`,
                            );
                            if (oldEvent) {
                                const oldName = str(oldEvent.name);
                                const newName = str(newEvent.name);
                                if (oldName !== newName)
                                    eventDetails.push(
                                        `**이름 변경:** \`\`\`${oldName}\`\`\` -> \`\`\`${newName}\`\`\``,
                                    );

                                const oldDesc = str(oldEvent.description);
                                const newDesc = str(newEvent.description);
                                if (oldDesc !== newDesc)
                                    eventDetails.push(
                                        `**설명 변경:** \`\`\`${(oldDesc || '').substring(0, 30)}...\`\`\` -> \`\`\`${(newDesc || '').substring(0, 30)}...\`\`\``,
                                    );

                                const oldStart = str(oldEvent.scheduledStartTime);
                                const newStart = str(newEvent.scheduledStartTime);
                                if (
                                    oldStart &&
                                    newStart &&
                                    new Date(oldStart).getTime() !== new Date(newStart).getTime()
                                ) {
                                    eventDetails.push(
                                        `**시작 시간 변경:** <t:${Math.floor(new Date(oldStart).getTime() / 1000)}:R> -> <t:${Math.floor(new Date(newStart).getTime() / 1000)}:R>`,
                                    );
                                }

                                const oldStatus = num(oldEvent.status);
                                const newStatus = num(newEvent.status);
                                if (oldStatus !== newStatus) {
                                    const statuses: Record<number, string> = {
                                        1: '예정',
                                        2: '활성',
                                        3: '완료됨',
                                        4: '취소됨',
                                    };
                                    eventDetails.push(
                                        `**상태 변경:** ${statuses[oldStatus] || `상태 ${oldStatus}`} -> ${statuses[newStatus] || `상태 ${newStatus}`}`,
                                    );
                                }

                                const oldType = num(oldEvent.entityType);
                                const newType = num(newEvent.entityType);
                                if (oldType !== newType) {
                                    const types: Record<number, string> = {
                                        1: '스테이지',
                                        2: '음성 채널',
                                        3: '외부 링크',
                                    };
                                    eventDetails.push(
                                        `**유형 변경:** ${types[oldType] || `타입 ${oldType}`} -> ${types[newType] || `타입 ${newType}`}`,
                                    );
                                }
                            } else {
                                eventDetails.push('(이전 이벤트 정보 없음)');
                            }
                        } else {
                            eventDetails.push('(이벤트 정보 없음)');
                        }
                        eventSpecificsText =
                            eventDetails.length > 0 ? eventDetails.join('\n') : '(내용 없음)';

                        const image = str(newEvent?.image);
                        const creatorId = str(newEvent?.creatorId);

                        if (newId && image) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/guild-events/${newId}/${image}.png?size=64`,
                                },
                            });
                        } else if (creatorId) {
                            try {
                                const creator = await interaction.client.users.fetch(creatorId);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: creator.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        } else if (log.user_id) {
                            try {
                                const executor = await interaction.client.users.fetch(log.user_id);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executor.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'guildScheduledEventDelete': {
                        const eventDetails: string[] = [];
                        const event = (data.scheduledEvent ?? data) as JsonData;
                        const id = str(event?.id);
                        if (event) {
                            eventDetails.push(`**삭제된 이벤트 이름:** ${str(event.name, 'N/A')}`);
                            if (id) eventDetails.push(`**ID:** ${id}`);
                            const creatorId = str(event.creatorId);
                            if (creatorId) {
                                try {
                                    const creator = await interaction.client.users.fetch(creatorId);
                                    eventDetails.push(
                                        `**생성자:** ${creator.tag} (<@${creatorId}>)`,
                                    );
                                } catch {
                                    eventDetails.push(`**생성자 ID:** ${creatorId}`);
                                }
                            }
                        }
                        eventSpecificsText =
                            eventDetails.length > 0 ? eventDetails.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const executor = await interaction.client.users.fetch(log.user_id);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executor.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'guildScheduledEventUserAdd': {
                        const details: string[] = [];
                        const eventId = str(data.scheduledEventId) || str(data.eventId);
                        const userId = str(data.userId);
                        const eventName = str(data.eventName);

                        if (eventName) details.push(`**이벤트:** ${eventName}`);
                        else if (eventId) details.push(`**이벤트 ID:** ${eventId}`);

                        if (userId) details.push(`**참가 사용자:** <@${userId}> (${userId})`);

                        const guild = interaction.guild;
                        if (eventId && !eventName && guild) {
                            try {
                                const guildEvent = await guild.scheduledEvents.fetch(eventId);
                                if (guildEvent?.name) {
                                    details.unshift(`**이벤트:** ${guildEvent.name}`);
                                } else if (guildEvent?.id) {
                                    details.unshift(
                                        `**이벤트 ID (이름 조회 불가):** ${guildEvent.id}`,
                                    );
                                }
                            } catch {
                                /* empty */
                            }
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';

                        const eventImage = str((data.guildScheduledEvent as JsonData)?.image);
                        const eventDataId = str((data.guildScheduledEvent as JsonData)?.id);

                        if (userId) {
                            try {
                                const user = await interaction.client.users.fetch(userId);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: user.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        } else if (eventImage && eventDataId) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/guild-events/${eventDataId}/${eventImage}.png?size=64`,
                                },
                            });
                        }
                        break;
                    }
                    case 'guildScheduledEventUserRemove': {
                        const details: string[] = [];
                        const eventId = str(data.scheduledEventId) || str(data.eventId);
                        const userId = str(data.userId);
                        const eventName = str(data.eventName);

                        if (eventName) details.push(`**이벤트:** ${eventName}`);
                        else if (eventId) details.push(`**이벤트 ID:** ${eventId}`);

                        if (userId) details.push(`**이탈 사용자:** <@${userId}> (${userId})`);

                        const guild = interaction.guild;
                        if (eventId && !eventName && guild) {
                            try {
                                const guildEvent = await guild.scheduledEvents.fetch(eventId);
                                if (guildEvent?.name) {
                                    details.unshift(`**이벤트:** ${guildEvent.name}`);
                                } else if (guildEvent?.id) {
                                    details.unshift(
                                        `**이벤트 ID (이름 조회 불가):** ${guildEvent.id}`,
                                    );
                                }
                            } catch {
                                /* empty */
                            }
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';

                        const eventImage = str((data.guildScheduledEvent as JsonData)?.image);
                        const eventDataId = str((data.guildScheduledEvent as JsonData)?.id);

                        if (userId) {
                            try {
                                const user = await interaction.client.users.fetch(userId);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: user.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        } else if (eventImage && eventDataId) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/guild-events/${eventDataId}/${eventImage}.png?size=64`,
                                },
                            });
                        }
                        break;
                    }

                    // INVITE EVENTS
                    case 'inviteCreate': {
                        const inviteDetails: string[] = [];
                        const invite = (data.invite ?? data) as JsonData;
                        const code = str(invite?.code);
                        if (invite) {
                            if (code) inviteDetails.push(`**초대 코드:** ${code}`);
                            const url = str(invite.url);
                            if (url) inviteDetails.push(`**URL:** ${url}`);

                            const inviterId =
                                str(invite.inviterId) || str((invite.inviter as JsonData)?.id);
                            const inviterTag = str((invite.inviter as JsonData)?.tag);

                            if (inviterId) {
                                try {
                                    const inviterUser =
                                        await interaction.client.users.fetch(inviterId);
                                    inviteDetails.push(
                                        `**생성자:** ${inviterUser.tag} (<@${inviterId}>)`,
                                    );
                                } catch {
                                    inviteDetails.push(`**생성자:** ${inviterTag || inviterId}`);
                                }
                            }

                            const channelId =
                                str(invite.channelId) || str((invite.channel as JsonData)?.id);
                            if (channelId) inviteDetails.push(`**채널:** <#${channelId}>`);

                            const uses = num(invite.uses);
                            if (uses !== undefined) inviteDetails.push(`**사용 횟수:** ${uses}`);

                            const maxUses = num(invite.maxUses);
                            if (maxUses !== undefined)
                                inviteDetails.push(
                                    `**최대 사용:** ${maxUses === 0 ? '무제한' : maxUses}`,
                                );

                            const maxAge = num(invite.maxAge);
                            if (maxAge !== undefined)
                                inviteDetails.push(
                                    `**만료:** ${maxAge === 0 ? '없음' : `${maxAge / 60 / 60}시간`}`,
                                );

                            const temporary = invite.temporary;
                            if (temporary !== undefined)
                                inviteDetails.push(
                                    `**임시 멤버십:** ${temporary ? '예' : '아니오'}`,
                                );

                            const createdAt = str(invite.createdAt);
                            if (createdAt)
                                inviteDetails.push(
                                    `**생성일:** <t:${Math.floor(new Date(createdAt).getTime() / 1000)}:R>`,
                                );
                        }
                        eventSpecificsText =
                            inviteDetails.length > 0 ? inviteDetails.join('\n') : '(내용 없음)';

                        const inviterIdForThumbnail =
                            str(invite?.inviterId) || str((invite?.inviter as JsonData)?.id);
                        if (inviterIdForThumbnail) {
                            try {
                                const inviterUser =
                                    await interaction.client.users.fetch(inviterIdForThumbnail);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: inviterUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        } else if (interaction.guild?.iconURL()) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: interaction.guild.iconURL({
                                        forceStatic: false,
                                        size: 64,
                                    })!,
                                },
                            });
                        }
                        break;
                    }
                    case 'inviteDelete': {
                        const inviteDetails: string[] = [];
                        const invite = (data.invite ?? data) as JsonData;
                        if (invite) {
                            const code = str(invite.code);
                            if (code) inviteDetails.push(`**삭제된 초대 코드:** ${code}`);
                            const channelId =
                                str(invite.channelId) || str((invite.channel as JsonData)?.id);
                            if (channelId) inviteDetails.push(`**채널:** <#${channelId}>`);
                        }
                        eventSpecificsText =
                            inviteDetails.length > 0 ? inviteDetails.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const user = await interaction.client.users.fetch(log.user_id);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: user.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        } else if (interaction.guild?.iconURL()) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: interaction.guild.iconURL({
                                        forceStatic: false,
                                        size: 64,
                                    })!,
                                },
                            });
                        }
                        break;
                    }

                    // GUILD SETTINGS UPDATE
                    case 'guildUpdate': {
                        const guildChanges: string[] = [];
                        const oldGuild = data.oldGuild as JsonData;
                        const newGuild = (data.newGuild ?? data.guild) as JsonData;

                        if (!oldGuild || !newGuild) {
                            eventSpecificsText = '길드 업데이트 정보 부족 (이전 또는 새 상태 누락)';
                            break;
                        }

                        guildChanges.push(
                            `**"${str(newGuild.name) || str(oldGuild.name)}" 설정 변경**`,
                        );

                        const oldName = str(oldGuild.name);
                        const newName = str(newGuild.name);
                        if (oldName !== newName)
                            guildChanges.push(
                                `**이름:** \`\`\`${oldName}\`\`\` -> \`\`\`${newName}\`\`\``,
                            );

                        if (str(oldGuild.icon) !== str(newGuild.icon))
                            guildChanges.push(`**아이콘 변경됨**`);
                        if (str(oldGuild.splash) !== str(newGuild.splash))
                            guildChanges.push(`**초대 배경 변경됨**`);
                        if (str(oldGuild.discoverySplash) !== str(newGuild.discoverySplash))
                            guildChanges.push(`**탐색 스플래시 변경됨**`);
                        if (str(oldGuild.banner) !== str(newGuild.banner))
                            guildChanges.push(`**배너 변경됨**`);

                        const oldOwnerId = str(oldGuild.ownerId);
                        const newOwnerId = str(newGuild.ownerId);
                        if (oldOwnerId !== newOwnerId) {
                            try {
                                const oldOwnerUser = oldOwnerId
                                    ? await interaction.client.users.fetch(oldOwnerId)
                                    : null;
                                const newOwnerUser = newOwnerId
                                    ? await interaction.client.users.fetch(newOwnerId)
                                    : null;
                                guildChanges.push(
                                    `**소유자:** ${oldOwnerUser?.tag ?? oldOwnerId} -> ${newOwnerUser?.tag ?? newOwnerId}`,
                                );
                            } catch {
                                guildChanges.push(`**소유자 ID:** ${oldOwnerId} -> ${newOwnerId}`);
                            }
                        }

                        const oldAfk = str(oldGuild.afkChannelId);
                        const newAfk = str(newGuild.afkChannelId);
                        if (oldAfk !== newAfk)
                            guildChanges.push(
                                `**자리비움 채널:** ${oldAfk ? `<#${oldAfk}>` : '없음'} -> ${newAfk ? `<#${newAfk}>` : '없음'}`,
                            );

                        const oldAfkTimeout = num(oldGuild.afkTimeout) || 0;
                        const newAfkTimeout = num(newGuild.afkTimeout) || 0;
                        if (oldAfkTimeout !== newAfkTimeout)
                            guildChanges.push(
                                `**자리비움 시간:** ${oldAfkTimeout / 60}분 -> ${newAfkTimeout / 60}분`,
                            );

                        const oldSystem = str(oldGuild.systemChannelId);
                        const newSystem = str(newGuild.systemChannelId);
                        if (oldSystem !== newSystem)
                            guildChanges.push(
                                `**시스템 채널:** ${oldSystem ? `<#${oldSystem}>` : '없음'} -> ${newSystem ? `<#${newSystem}>` : '없음'}`,
                            );

                        const oldVerif = num(oldGuild.verificationLevel);
                        const newVerif = num(newGuild.verificationLevel);
                        if (oldVerif !== newVerif)
                            guildChanges.push(
                                `**인증 수준 변경됨** (L${oldVerif} -> L${newVerif})`,
                            );

                        const oldFilter = num(oldGuild.explicitContentFilter);
                        const newFilter = num(newGuild.explicitContentFilter);
                        if (oldFilter !== newFilter)
                            guildChanges.push(
                                `**콘텐츠 필터 변경됨** (L${oldFilter} -> L${newFilter})`,
                            );

                        const oldMfa = num(oldGuild.mfaLevel);
                        const newMfa = num(newGuild.mfaLevel);
                        if (oldMfa !== newMfa)
                            guildChanges.push(`**2FA 요구사항 변경됨** (L${oldMfa} -> L${newMfa})`);

                        const oldVanity = str(oldGuild.vanityURLCode);
                        const newVanity = str(newGuild.vanityURLCode);
                        if (oldVanity !== newVanity)
                            guildChanges.push(
                                `** Vanity URL:** \`\`\`${oldVanity || '없음'}\`\`\` -> \`\`\`${newVanity || '없음'}\`\`\``,
                            );

                        const oldDesc = str(oldGuild.description);
                        const newDesc = str(newGuild.description);
                        if (oldDesc !== newDesc)
                            guildChanges.push(
                                `**설명 변경:** \`\`\`${(oldDesc || '').substring(0, 30)}...\`\`\` -> \`\`\`${(newDesc || '').substring(0, 30)}...\`\`\``,
                            );

                        const oldLocale = str(oldGuild.preferredLocale);
                        const newLocale = str(newGuild.preferredLocale);
                        if (oldLocale !== newLocale)
                            guildChanges.push(`**기본 언어:** ${oldLocale} -> ${newLocale}`);

                        eventSpecificsText =
                            guildChanges.length > 1
                                ? guildChanges.join('\n')
                                : `서버 설정 변경됨 (세부사항 확인 필요)`;

                        const guildForIcon = interaction.guild;
                        const newIcon = str(newGuild.icon);
                        const newId = str(newGuild.id);

                        if (guildForIcon?.iconURL()) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: guildForIcon.iconURL({ forceStatic: false, size: 64 })!,
                                },
                            });
                        } else if (newIcon && newId) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/icons/${newId}/${newIcon}.png?size=64`,
                                },
                            });
                        } else if (log.user_id) {
                            try {
                                const executor = await interaction.client.users.fetch(log.user_id);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executor.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }

                    // CHANNEL EVENTS
                    case 'channelCreate': {
                        const details: string[] = [];
                        const channel = (data.channel ?? data) as JsonData;

                        const name = str(channel?.name);
                        const id = str(channel?.id);
                        if (name) details.push(`**채널 이름:** ${name}`);
                        if (id) details.push(`**ID:** ${id}`);

                        const parentId = str(channel?.parentId);
                        if (parentId) details.push(`**카테고리:** <#${parentId}>`);

                        const type = num(channel?.type);
                        if (type !== undefined)
                            details.push(`**타입:** ${ChannelType[type] ?? type}`);

                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executorUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        } else if (interaction.guild?.iconURL()) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: interaction.guild.iconURL({
                                        forceStatic: false,
                                        size: 64,
                                    })!,
                                },
                            });
                        }
                        break;
                    }
                    case 'channelDelete': {
                        const details: string[] = [];
                        const channel = (data.channel ?? data) as JsonData;

                        const name = str(channel?.name);
                        const id = str(channel?.id);
                        if (name) details.push(`**삭제된 채널 이름:** ${name}`);
                        if (id) details.push(`**ID:** ${id}`);

                        const parentId = str(channel?.parentId);
                        if (parentId) details.push(`**카테고리:** <#${parentId}>`);

                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executorUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        } else if (interaction.guild?.iconURL()) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: interaction.guild.iconURL({
                                        forceStatic: false,
                                        size: 64,
                                    })!,
                                },
                            });
                        }
                        break;
                    }
                    case 'channelUpdate': {
                        const details: string[] = [];
                        const oldChannel = data.oldChannel as JsonData;
                        const newChannel = (data.newChannel ?? data.channel) as JsonData;

                        const newName = str(newChannel?.name);
                        const newId = str(newChannel?.id);

                        if (newChannel) {
                            details.push(
                                `**채널:** ${newName || 'N/A'} (<#${newId || 'ID 없음'}>)`,
                            );
                            if (oldChannel) {
                                const oldName = str(oldChannel.name);
                                if (oldName !== newName)
                                    details.push(
                                        `**이름 변경:** \`\`\`${oldName}\`\`\` -> \`\`\`${newName}\`\`\``,
                                    );

                                const oldTopic = str(oldChannel.topic);
                                const newTopic = str(newChannel.topic);
                                if (oldTopic !== newTopic)
                                    details.push(
                                        `**주제 변경:** \`\`\`${(oldTopic || '').substring(0, 30)}...\`\`\` -> \`\`\`${(newTopic || '').substring(0, 30)}...\`\`\``,
                                    );

                                const oldParent = str(oldChannel.parentId);
                                const newParent = str(newChannel.parentId);
                                if (oldParent !== newParent)
                                    details.push(
                                        `**카테고리 변경:** ${oldParent ? `<#${oldParent}>` : '없음'} -> ${newParent ? `<#${newParent}>` : '없음'}`,
                                    );

                                const oldType = num(oldChannel.type);
                                const newType = num(newChannel.type);
                                if (oldType !== newType) {
                                    details.push(
                                        `**타입 변경:** ${oldType !== undefined ? (ChannelType[oldType] ?? oldType) : 'unknown'} -> ${newType !== undefined ? (ChannelType[newType] ?? newType) : 'unknown'}`,
                                    );
                                }

                                const oldNsfw = oldChannel.nsfw;
                                const newNsfw = newChannel.nsfw;
                                if (oldNsfw !== newNsfw)
                                    details.push(
                                        `**NSFW:** ${oldNsfw ? '예' : '아니오'} -> ${newNsfw ? '예' : '아니오'}`,
                                    );

                                const oldRate = num(oldChannel.rateLimitPerUser);
                                const newRate = num(newChannel.rateLimitPerUser);
                                if (oldRate !== newRate)
                                    details.push(
                                        `**슬로우 모드:** ${oldRate || 0}초 -> ${newRate || 0}초`,
                                    );
                            } else {
                                details.push('(이전 채널 정보 없음)');
                            }
                        } else {
                            details.push('채널 정보 없음');
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executorUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'channelPinsUpdate': {
                        const details: string[] = [];
                        const channelId =
                            str(data.channelId) || str((data.channel as JsonData)?.id);
                        const lastPinTimestamp = str(data.lastPinTimestamp) || str(data.timestamp);

                        if (channelId) details.push(`**채널:** <#${channelId}>`);
                        if (lastPinTimestamp) {
                            details.push(
                                `**마지막 고정 시간:** <t:${Math.floor(new Date(lastPinTimestamp).getTime() / 1000)}:F>`,
                            );
                        } else {
                            details.push('채널 고정핀 업데이트됨');
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const user = await interaction.client.users.fetch(log.user_id);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: user.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }

                    // THREAD EVENTS
                    case 'threadCreate': {
                        const details: string[] = [];
                        const thread = (data.thread ?? data) as JsonData;
                        const name = str(thread?.name);
                        const id = str(thread?.id);
                        const parentId = str(thread?.parentId);
                        const ownerId = str(thread?.ownerId);

                        if (thread) {
                            details.push(
                                `**스레드 이름:** ${name || 'N/A'} (<#${id || 'ID 없음'}>)`,
                            );
                            if (id) details.push(`**ID:** ${id}`);
                            if (parentId) details.push(`**상위 채널:** <#${parentId}>`);
                            if (ownerId) {
                                try {
                                    const owner = await interaction.client.users.fetch(ownerId);
                                    details.push(`**생성자:** ${owner.tag} (<@${ownerId}>)`);
                                } catch {
                                    details.push(`**생성자 ID:** ${ownerId}`);
                                }
                            }
                            const duration = num(thread.autoArchiveDuration);
                            if (duration) details.push(`**자동 보관:** ${duration / 60}분`);
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';
                        if (ownerId) {
                            try {
                                const owner = await interaction.client.users.fetch(ownerId);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: owner.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'threadDelete': {
                        const details: string[] = [];
                        const thread = (data.thread ?? data) as JsonData;
                        const name = str(thread?.name);
                        const id = str(thread?.id);
                        const parentId = str(thread?.parentId);

                        if (thread) {
                            details.push(`**삭제된 스레드 이름:** ${name || 'N/A'}`);
                            if (id) details.push(`**ID:** ${id}`);
                            if (parentId) details.push(`**상위 채널:** <#${parentId}>`);
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const executor = await interaction.client.users.fetch(log.user_id);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executor.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    case 'threadUpdate': {
                        const details: string[] = [];
                        const oldThread = data.oldThread as JsonData;
                        const newThread = (data.newThread ?? data.thread) as JsonData;
                        const newName = str(newThread?.name);
                        const newId = str(newThread?.id);

                        if (newThread) {
                            details.push(
                                `**스레드:** ${newName || 'N/A'} (<#${newId || 'ID 없음'}>)`,
                            );
                            if (oldThread) {
                                const oldName = str(oldThread.name);
                                if (oldName !== newName)
                                    details.push(
                                        `**이름 변경:** \`\`\`${oldName}\`\`\` -> \`\`\`${newName}\`\`\``,
                                    );

                                const oldArchived = oldThread.archived;
                                const newArchived = newThread.archived;
                                if (oldArchived !== newArchived)
                                    details.push(
                                        `**보관 상태:** ${oldArchived ? '보관됨' : '활성'} -> ${newArchived ? '보관됨' : '활성'}`,
                                    );

                                const oldLocked = oldThread.locked;
                                const newLocked = newThread.locked;
                                if (oldLocked !== newLocked)
                                    details.push(
                                        `**잠금 상태:** ${oldLocked ? '잠김' : '해제'} -> ${newLocked ? '잠김' : '해제'}`,
                                    );

                                const oldDur = num(oldThread.autoArchiveDuration);
                                const newDur = num(newThread.autoArchiveDuration);
                                if (oldDur !== newDur)
                                    details.push(
                                        `**자동 보관 변경:** ${oldDur ? oldDur / 60 : 0}분 -> ${newDur ? newDur / 60 : 0}분`,
                                    );
                            } else {
                                details.push('(이전 스레드 정보 없음)');
                            }
                        } else {
                            details.push('스레드 정보 없음');
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';
                        if (log.user_id) {
                            try {
                                const executor = await interaction.client.users.fetch(log.user_id);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: executor.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    // USER UPDATE (e.g. username, avatar)
                    case 'userUpdate': {
                        const details: string[] = [];
                        const oldUser = data.oldUser as JsonData;
                        const newUser = (data.newUser ?? data.user) as JsonData;

                        const newTag = str(newUser?.tag) || str(newUser?.username);
                        const newId = str(newUser?.id);

                        if (newUser) {
                            details.push(`**사용자:** ${newTag || newId} (<@${newId}>)`);
                            if (oldUser) {
                                const oldUsername = str(oldUser.username);
                                const newUsername = str(newUser.username);
                                if (oldUsername !== newUsername)
                                    details.push(
                                        `**사용자명 변경:** \`\`\`${oldUsername}\`\`\` -> \`\`\`${newUsername}\`\`\``,
                                    );

                                const oldDisc = str(oldUser.discriminator);
                                const newDisc = str(newUser.discriminator);
                                if (oldDisc !== newDisc)
                                    details.push(`**태그 변경:** #${oldDisc} -> #${newDisc}`);

                                if (str(oldUser.avatar) !== str(newUser.avatar))
                                    details.push(`**아바타 변경됨**`);

                                const oldGlobal = str(oldUser.globalName);
                                const newGlobal = str(newUser.globalName);
                                if (oldGlobal !== newGlobal)
                                    details.push(
                                        `**표시 이름 변경:** \`\`\`${oldGlobal || '(없음)'}\`\`\` -> \`\`\`${newGlobal || '(없음)'}\`\`\``,
                                    );
                            }
                        } else {
                            details.push('사용자 정보 없음');
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\n') : '(내용 없음)';
                        if (newId) {
                            try {
                                const updatedUser = await interaction.client.users.fetch(newId);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: updatedUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    // VOICE STATE UPDATE
                    case 'voiceStateUpdate': {
                        const details: string[] = [];
                        const oldState = data.oldState as JsonData;
                        const newState = (data.newState ?? data.state) as JsonData;
                        const member = (data.member ??
                            newState?.member ??
                            oldState?.member) as JsonData;
                        const userId = str(newState?.id) || str(oldState?.id) || str(member?.id);
                        const userTag = str((member?.user as JsonData)?.tag) || str(data.userTag);

                        if (userId) {
                            details.push(`**사용자:** ${userTag || `<@${userId}>`} (${userId})`);
                        }

                        const oldChannelId = str(oldState?.channelId);
                        const newChannelId = str(newState?.channelId);

                        if (oldChannelId && !newChannelId) {
                            details.push(`음성 채널 <#${oldChannelId}> 나감`);
                        } else if (!oldChannelId && newChannelId) {
                            details.push(`음성 채널 <#${newChannelId}> 참가`);
                        } else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
                            details.push(`음성 채널 <#${oldChannelId}> -> <#${newChannelId}> 이동`);
                        } else if (!oldChannelId && !newChannelId && oldState && newState) {
                            // Other state changes, e.g. mute, deafen, stream
                            if (oldState.serverMute !== newState.serverMute)
                                details.push(
                                    `**서버 음소거:** ${oldState.serverMute ? '설정' : '해제'} -> ${newState.serverMute ? '설정' : '해제'}`,
                                );
                            if (oldState.serverDeaf !== newState.serverDeaf)
                                details.push(
                                    `**서버 헤드셋음소거:** ${oldState.serverDeaf ? '설정' : '해제'} -> ${newState.serverDeaf ? '설정' : '해제'}`,
                                );
                            if (oldState.selfMute !== newState.selfMute)
                                details.push(
                                    `**개인 음소거:** ${oldState.selfMute ? '설정' : '해제'} -> ${newState.selfMute ? '설정' : '해제'}`,
                                );
                            if (oldState.selfDeaf !== newState.selfDeaf)
                                details.push(
                                    `**개인 헤드셋음소거:** ${oldState.selfDeaf ? '설정' : '해제'} -> ${newState.selfDeaf ? '설정' : '해제'}`,
                                );
                            if (oldState.streaming !== newState.streaming)
                                details.push(
                                    `**스트리밍:** ${oldState.streaming ? '시작' : '중지'} -> ${newState.streaming ? '시작' : '중지'}`,
                                );
                            if (oldState.selfVideo !== newState.selfVideo)
                                details.push(
                                    `**카메라:** ${oldState.selfVideo ? '켬' : '끔'} -> ${newState.selfVideo ? '켬' : '끔'}`,
                                );
                        } else {
                            details.push('음성 상태 변경 (세부사항 불명확)');
                        }

                        // If details still only has user, add a generic message
                        if (details.length === 1 && userId) {
                            details.push('음성 상태 변경됨 (채널 변경 외)');
                        } else if (details.length === 0) {
                            details.push('음성 상태 업데이트 정보 없음');
                        }

                        eventSpecificsText = details.join('\n');
                        if (userId) {
                            try {
                                const user = await interaction.client.users.fetch(userId);
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: user.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    default:
                        // 기본적으로 event_data를 JSON 문자열로 표시하거나, 간단한 텍스트로 변환
                        if (Object.keys(data).length > 0) {
                            eventSpecificsText = `\`\`\`json\n${JSON.stringify(data, null, 2)}\`\`\``;
                            if (eventSpecificsText.length > 750) {
                                // 너무 길면 자르기
                                eventSpecificsText =
                                    eventSpecificsText.substring(0, 750) + '...```';
                            }
                        } else {
                            eventSpecificsText = '(기록된 세부 정보 없음)';
                        }
                        break;
                }
            }

            const currentEventConfig = Object.values(eventConfigurations).find(
                (c) => c.dbEventType === log.event_type,
            );
            const friendlyEventName = currentEventConfig
                ? currentEventConfig.friendlyName
                : log.event_type;

            const infoTextContent =
                `**이벤트:** ${friendlyEventName} (${log.event_type})\n` +
                `${log.channel_id ? `**채널:** <#${log.channel_id}>\n` : ''}` +
                // guildMemberAdd/Remove의 경우 사용자 정보는 eventSpecificsText에서 더 자세히 다룸
                // 그 외 이벤트는 기존 방식 유지
                (!['guildMemberAdd', 'guildMemberRemove'].includes(log.event_type) && log.user_id
                    ? `**사용자:** <@${log.user_id}>\n`
                    : !['guildMemberAdd', 'guildMemberRemove'].includes(log.event_type)
                      ? '**사용자:** 시스템\n'
                      : '') +
                `**내용:**\n${eventSpecificsText}`;
            const infoContentString = infoTextContent.substring(0, 2000);
            const infoText = new TextDisplayBuilder().setContent(infoContentString); // Max length for text display

            const sectionComponent = new SectionBuilder()
                .addTextDisplayComponents(timestampText, infoText)
                .setThumbnailAccessory(thumbnailComponent);

            const logTextSize = timestampContent.length + infoContentString.length;

            if (currentTextSize + logTextSize > MAX_TEXT_SIZE) {
                break;
            }

            currentTextSize += logTextSize;
            displayableComponents.push(sectionComponent);
            logsDisplayed++;

            const eventData = log.event_data as { attachments?: AttachmentLogData[] };
            if (eventData && Array.isArray(eventData.attachments)) {
                for (const attachmentData of eventData.attachments) {
                    if (attachmentData.webdavPath && attachmentData.filename) {
                        let nasFileBuffer: Buffer | null = null;
                        try {
                            nasFileBuffer = await storageManager.download(
                                attachmentData.webdavPath,
                            );
                        } catch {
                            // Suppress error if file not found or download failed
                        }
                        if (nasFileBuffer) {
                            const uniqueAttachmentFilename =
                                `${log.id}_${attachmentData.id}_${attachmentData.filename}`.replace(
                                    /[^a-zA-Z0-9_.-]/g,
                                    '_',
                                );
                            const discordAttachment = new AttachmentBuilder(nasFileBuffer, {
                                name: uniqueAttachmentFilename,
                            });
                            attachmentsToSend.push(discordAttachment);
                            const fileComponent = new FileBuilder().setURL(
                                `attachment://${uniqueAttachmentFilename}`,
                            );
                            displayableComponents.push(fileComponent);
                        } else if (attachmentData.discordUrl) {
                            const attText = `📎 [${attachmentData.filename ?? '첨부파일'} (다운로드 실패)](${attachmentData.discordUrl})`;
                            if (currentTextSize + attText.length > MAX_TEXT_SIZE) break;
                            currentTextSize += attText.length;
                            displayableComponents.push(
                                new TextDisplayBuilder().setContent(attText),
                            );
                        }
                    } else if (attachmentData.discordUrl) {
                        const attText = `📎 [${attachmentData.filename ?? '첨부파일'}](${attachmentData.discordUrl})`;
                        if (currentTextSize + attText.length > MAX_TEXT_SIZE) break;
                        currentTextSize += attText.length;
                        displayableComponents.push(new TextDisplayBuilder().setContent(attText));
                    }
                }
            }
            if (logs.indexOf(log) < logs.length - 1) {
                displayableComponents.push(new SeparatorBuilder());
            }
        }

        summaryBuilder.setContent(
            noOptionsProvidedInitially && currentOffset === 0 && totalCount > 0
                ? `최근 로그 (${totalCount}개 중 ${logsDisplayed}개 표시)`
                : `검색 결과 (${totalCount}개 중 ${logsDisplayed}개 표시)`,
        );

        if (displayableComponents.length <= 1 && totalCount > 0 && attachmentsToSend.length === 0) {
            // <= 1 because we added summary and separator
            displayableComponents.push(
                new TextDisplayBuilder().setContent(
                    '로그를 표시하는 중 문제가 발생했습니다. (컴포넌트 생성 실패 또는 표시할 내용 없음)',
                ),
            );
        }

        const prevOffset = Math.max(0, currentOffset - PAGE_SIZE);
        const prevButton = new ButtonBuilder()
            .setCustomId(`log_search_prev_${prevOffset}_${currentPage - 1}`)
            .setLabel('이전')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0);

        const nextOffset = currentOffset + logsDisplayed;
        const nextButton = new ButtonBuilder()
            .setCustomId(`log_search_next_${nextOffset}_${currentPage + 1}`)
            .setLabel('다음')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(nextOffset >= totalCount);

        const pageInfo = new ButtonBuilder()
            .setCustomId('log_search_pageinfo')
            .setLabel(`페이지: ${currentPage + 1} / ${Math.ceil(totalCount / PAGE_SIZE)}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);

        let buttonActionRow =
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                prevButton,
                pageInfo,
                nextButton,
            );
        if (includeCloseButton) {
            const closeButton = new ButtonBuilder()
                .setCustomId('log_search_close')
                .setLabel('닫기')
                .setStyle(ButtonStyle.Danger);
            buttonActionRow =
                new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                    prevButton,
                    pageInfo,
                    nextButton,
                    closeButton,
                );
        }

        editReplyOptions.flags = MessageFlags.IsComponentsV2;
        editReplyOptions.components = [...displayableComponents, buttonActionRow];
        editReplyOptions.files = attachmentsToSend;

        await interaction.editReply(editReplyOptions);
        logger.info(
            `Sent logs (offset: ${currentOffset}, limit: ${PAGE_SIZE}, total: ${totalCount}) with V2 components and pagination for ${interaction.user.tag}`,
        );
    } catch (error) {
        logger.error('Error during fetchAndDisplayLogs:', error);
        const errorEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('오류 발생')
            .setDescription('로그 표시 중 오류가 발생했습니다.');
        const errorReplyOptions: InteractionEditReplyOptions = {
            embeds: [errorEmbed],
            components: [],
            files: [],
            allowedMentions: { parse: [] }, // Also apply to error messages
            flags: MessageFlags.IsComponentsV2,
        };

        if (interaction.replied || interaction.deferred) {
            try {
                await interaction.editReply(errorReplyOptions);
            } catch (editError) {
                logger.error(
                    'Failed to send error embed via editReply after initial reply/defer:',
                    editError,
                );
            }
        } else {
            try {
                const replyOptionsForInitialError: InteractionReplyOptions = {
                    embeds: errorReplyOptions.embeds,
                    components: errorReplyOptions.components,
                    flags: MessageFlags.Ephemeral,
                    allowedMentions: { parse: [] }, // Also apply to initial error replies
                };
                if (errorReplyOptions.files && errorReplyOptions.files.length > 0) {
                    replyOptionsForInitialError.files = errorReplyOptions.files;
                }
                await interaction.reply(replyOptionsForInitialError);
            } catch (replyError) {
                logger.error(
                    'Failed to send error reply for ChatInputCommandInteraction:',
                    replyError,
                );
            }
        }
    }
}

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
        const eventType = args['event-type'];

        let startDate: Date | undefined = undefined;
        let endDate: Date | undefined = undefined;
        if (startDateString) startDate = parseDateString(startDateString, false) ?? undefined;
        if (endDateString) endDate = parseDateString(endDateString, true) ?? undefined;
        if (startDateString) {
            const parsed = parseDateString(startDateString, false);
            if (!parsed) {
                await message.reply({
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
                await message.reply({
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
            await message.reply({
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
        } as unknown as ChatInputCommandInteraction;

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
                filter: (i) =>
                    i.customId.startsWith('log_search_') && i.user.id === message.author.id,
                componentType: ComponentType.Button,
                time: 15 * 60 * 1000,
            });

            collector.on('collect', (i) => {
                (async () => {
                    if (!i.isButton()) return;

                    if (i.customId === 'log_search_close') {
                        await i.update({
                            flags: MessageFlags.IsComponentsV2,
                            components: [
                                new TextDisplayBuilder().setContent('이 메시지는 곧 삭제됩니다.'),
                            ],
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
                    } else if (action === 'pageinfo') {
                        // pageinfo 버튼은 아무것도 하지 않음 (이미 disabled 상태)
                    } else {
                        logger.warn(`Unknown button action or invalid offset: ${i.customId}`);
                    }
                })().catch((err) => logger.error('Error in collector:', err));
            });
        } catch (fetchReplyError) {
            logger.error('Failed to fetch reply for collector setup:', fetchReplyError);
            // 초기 fetchAndDisplayLogs 에서 오류가 발생하면 이미 editReply로 응답했을 수 있음.
            // 이 경우 추가적인 오류 메시지 전송은 자제.
        }
    },
};

export { command };

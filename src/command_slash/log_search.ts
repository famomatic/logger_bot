import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SectionBuilder,
    MessageFlags,
    SeparatorBuilder,
    FileBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageComponentInteraction,
    InteractionEditReplyOptions,
    MessageActionRowComponentBuilder,
    InteractionReplyOptions,
    PermissionsBitField,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/config.js';
import {
    getEventTypeChoices,
    isValidEventType,
    eventConfigurations,
} from '../config/eventsConfig.js';
import { searchLogs } from '../db/database.js';
import { storageManager } from '../storage/StorageManager.js';
import { escapeCodeBlockContent } from '../utils/sanitize.js';

/**
 * Recursive type for JSONB data from the database. Allows type-safe nested property access
 * on deserialized JSON objects without using `any`.
 */
interface JsonData {
    [key: string]: JsonData | string | number | boolean | null | undefined | JsonData[];
}

/** Safely converts an unknown/JsonData value to a string. Returns fallback if nullish. */
function str(
    val: JsonData | string | number | boolean | null | undefined | JsonData[],
    fallback = '',
): string {
    if (val == null) return fallback;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return JSON.stringify(val);
}

/** Safely converts a value to a number. Returns fallback if not a valid number. */
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

const PAGE_SIZE = 5; // 페이지당 로그 수

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
    const name =
        typeof sticker.name === 'string' && sticker.name.length > 0 ? sticker.name : '이름 없음';
    parts.push(`${index + 1}. ${name}`);

    const metadata: string[] = [];
    if (typeof sticker.id === 'string' && sticker.id.length > 0) {
        metadata.push(`ID ${sticker.id}`);
    }

    let formatLabel: string | undefined;
    if (typeof sticker.format === 'number') {
        formatLabel = STICKER_FORMAT_LABELS[sticker.format] ?? `형식 ${sticker.format}`;
    } else if (typeof sticker.format_type === 'number') {
        formatLabel = STICKER_FORMAT_LABELS[sticker.format_type] ?? `형식 ${sticker.format_type}`;
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
                        const content = typeof data.content === 'string' ? data.content : '';
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
                        const memberAddDetails = [];
                        if (data.memberTag)
                            memberAddDetails.push(
                                `**사용자:** ${str(data.memberTag)} (${str(data.memberId, 'ID 없음')})`,
                            );
                        else if (data.memberId)
                            memberAddDetails.push(`**사용자 ID:** ${str(data.memberId)}`);
                        if (data.inviterId) {
                            try {
                                const inviter = await interaction.client.users.fetch(
                                    str(data.inviterId),
                                );
                                memberAddDetails.push(
                                    `**초대자:** ${inviter.tag} (${str(data.inviterId)})`,
                                );
                            } catch {
                                memberAddDetails.push(`**초대자 ID:** ${str(data.inviterId)}`);
                            }
                        }
                        if (data.inviteCode)
                            memberAddDetails.push(`**초대 코드:** ${str(data.inviteCode)}`);
                        eventSpecificsText =
                            memberAddDetails.length > 0
                                ? memberAddDetails.join('\n')
                                : '멤버 참가 정보 없음';
                        // Update thumbnail to the added member if possible
                        try {
                            const addedMemberUser = data.memberId
                                ? await interaction.client.users.fetch(str(data.memberId))
                                : null;
                            if (addedMemberUser) {
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: addedMemberUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            }
                        } catch {
                            /* Keep original thumbnail if fetch fails */
                        }
                        break;
                    }
                    case 'guildMemberRemove': {
                        const memberRemoveDetails = [];
                        if (data.memberTag)
                            memberRemoveDetails.push(
                                `**사용자:** ${str(data.memberTag)} (${str(data.memberId, 'ID 없음')})`,
                            );
                        else if (data.memberId)
                            memberRemoveDetails.push(`**사용자 ID:** ${str(data.memberId)}`);
                        if (data.reason) memberRemoveDetails.push(`**사유:** ${str(data.reason)}`);
                        if (data.executorId) {
                            try {
                                const executor = await interaction.client.users.fetch(
                                    str(data.executorId),
                                );
                                memberRemoveDetails.push(
                                    `**실행자:** ${executor.tag} (${str(data.executorId)})`,
                                );
                            } catch {
                                memberRemoveDetails.push(`**실행자 ID:** ${str(data.executorId)}`);
                            }
                        }
                        eventSpecificsText =
                            memberRemoveDetails.length > 0
                                ? memberRemoveDetails.join('\n')
                                : '멤버 이탈 정보 없음';
                        // Update thumbnail to the removed member if possible
                        try {
                            const removedMemberUser = data.memberId
                                ? await interaction.client.users.fetch(str(data.memberId))
                                : null;
                            if (removedMemberUser) {
                                thumbnailComponent = new ThumbnailBuilder({
                                    media: {
                                        url: removedMemberUser.displayAvatarURL({
                                            forceStatic: false,
                                            size: 64,
                                        }),
                                    },
                                });
                            }
                        } catch {
                            /* Keep original thumbnail if fetch fails */
                        }
                        break;
                    }
                    case 'guildMemberUpdate': {
                        const memberUpdateDetails = [];
                        const updatedMember =
                            (data.member as JsonData | null) ??
                            (log.user_id
                                ? {
                                      id: log.user_id,
                                      tag: str((data.user as JsonData)?.tag, `<@${log.user_id}>`),
                                  }
                                : null);

                        if (updatedMember) {
                            memberUpdateDetails.push(
                                `**사용자:** ${str(data.memberTag) || str(updatedMember.tag) || `<@${str(updatedMember.id)}>`} (${str(updatedMember.id)})`,
                            );
                        }

                        // Assuming roles are stored as an array of objects with id and name, or just an array of IDs.
                        // The actual structure depends on how guildMemberUpdate is logged.
                        // For d.js v14, member.roles.cache is a Collection<Snowflake, Role>
                        // If event_data.oldMember.roles or .newMember.roles is logged, it might be a serialized version.

                        const getRoleMap = (
                            rolesData:
                                | JsonData
                                | JsonData[]
                                | string
                                | number
                                | boolean
                                | null
                                | undefined,
                        ): Map<string, string | undefined> => {
                            const map = new Map<string, string | undefined>();
                            if (
                                rolesData &&
                                typeof rolesData === 'object' &&
                                !Array.isArray(rolesData) &&
                                rolesData.cache &&
                                typeof (rolesData.cache as JsonData).forEach === 'function'
                            ) {
                                // d.js RoleManager structure - unlikely in serialized JSONB but handle gracefully
                            } else if (Array.isArray(rolesData)) {
                                for (const role of rolesData) {
                                    if (typeof role === 'string') map.set(role, undefined);
                                    else if (
                                        role &&
                                        typeof role === 'object' &&
                                        !Array.isArray(role) &&
                                        role.id
                                    )
                                        map.set(
                                            str(role.id),
                                            typeof role.name === 'string' ? role.name : undefined,
                                        );
                                }
                            }
                            return map;
                        };

                        const oldRoleMap = getRoleMap(
                            (data.oldMember as JsonData)?.roles ?? data.oldRoles,
                        );
                        const newRoleMap = getRoleMap(
                            (data.newMember as JsonData)?.roles ?? data.newRoles,
                        );

                        const addedRoles = [];
                        for (const [roleId, roleName] of newRoleMap) {
                            if (!oldRoleMap.has(roleId)) {
                                const name =
                                    roleName ??
                                    interaction.guild?.roles.cache.get(roleId)?.name ??
                                    '알 수 없는 역할';
                                addedRoles.push(`${name} (<@&${roleId}>)`);
                            }
                        }

                        const removedRoles = [];
                        for (const [roleId, roleName] of oldRoleMap) {
                            if (!newRoleMap.has(roleId)) {
                                const name =
                                    roleName ??
                                    interaction.guild?.roles.cache.get(roleId)?.name ??
                                    '알 수 없는 역할';
                                removedRoles.push(`${name} (<@&${roleId}>)`);
                            }
                        }

                        if (addedRoles.length > 0) {
                            memberUpdateDetails.push(`**추가된 역할:** ${addedRoles.join(', ')}`);
                        }
                        if (removedRoles.length > 0) {
                            memberUpdateDetails.push(`**제거된 역할:** ${removedRoles.join(', ')}`);
                        }

                        if (
                            data.oldNickname !== undefined &&
                            data.newNickname !== undefined &&
                            data.oldNickname !== data.newNickname
                        ) {
                            memberUpdateDetails.push(
                                `**닉네임 변경:** \\\`${str(data.oldNickname, '(없음)')}\\\` -> \\\`${str(data.newNickname, '(없음)')}\\\``,
                            );
                        }
                        if (data.oldAvatar !== data.newAvatar && data.newAvatar) {
                            memberUpdateDetails.push(`**아바타 변경됨**`);
                        }
                        if (
                            data.oldCommunicationDisabledUntil !==
                            data.newCommunicationDisabledUntil
                        ) {
                            const oldTimeout = data.oldCommunicationDisabledUntil
                                ? `<t:${Math.floor(new Date(str(data.oldCommunicationDisabledUntil)).getTime() / 1000)}:R>`
                                : '없음';
                            const newTimeout = data.newCommunicationDisabledUntil
                                ? `<t:${Math.floor(new Date(str(data.newCommunicationDisabledUntil)).getTime() / 1000)}:R>`
                                : '해제됨';
                            memberUpdateDetails.push(
                                `**타임아웃 변경:** ${oldTimeout} -> ${newTimeout}`,
                            );
                        }

                        // If only user info pushed and no other changes, adjust message
                        if (memberUpdateDetails.length === 1 && updatedMember) {
                            eventSpecificsText =
                                memberUpdateDetails.join('\n') +
                                '\n(세부 변경 사항 감지 안됨, 역할/닉네임 외 변경 가능성 있음)';
                        } else if (memberUpdateDetails.length > (updatedMember ? 1 : 0)) {
                            eventSpecificsText = memberUpdateDetails.join('\n');
                        } else {
                            eventSpecificsText =
                                '멤버 업데이트 (세부 정보 분석 중 오류 또는 변경 사항 없음)';
                        }

                        if (updatedMember?.id) {
                            try {
                                // log.user_id should be the ID of the updated member for guildMemberUpdate
                                const memberUser = await interaction.client.users.fetch(
                                    log.user_id ?? str(updatedMember.id),
                                );
                                if (memberUser) {
                                    thumbnailComponent = new ThumbnailBuilder({
                                        media: {
                                            url: memberUser.displayAvatarURL({
                                                forceStatic: false,
                                                size: 64,
                                            }),
                                        },
                                    });
                                }
                            } catch {
                                /* Keep original or default thumbnail */
                            }
                        }
                        break;
                    }

                    case 'guildRoleCreate': {
                        const roleCreateDetails = [];
                        const role = data.role as JsonData;
                        if (role) {
                            roleCreateDetails.push(
                                `**역할 이름:** ${str(role.name, 'N/A')} (<@&${str(role.id, 'ID 없음')}>)`,
                            );
                            if (role.id) roleCreateDetails.push(`**역할 ID:** ${str(role.id)}`);
                            if (role.color)
                                roleCreateDetails.push(
                                    `**색상:** #${num(role.color).toString(16).padStart(6, '0')}`,
                                );
                            if (role.permissions) {
                                const permissions = new PermissionsBitField(
                                    BigInt(str(role.permissions, '0')),
                                );
                                const permArray = permissions.toArray();
                                if (permArray.length > 0) {
                                    roleCreateDetails.push(
                                        `**권한 (${permArray.length}개):** ${permArray.slice(0, 3).join(', ')}${permArray.length > 3 ? ', ...' : ''}`,
                                    );
                                } else {
                                    roleCreateDetails.push(`**권한:** 없음`);
                                }
                            }
                        }
                        eventSpecificsText =
                            roleCreateDetails.length > 0
                                ? roleCreateDetails.join('\n')
                                : '역할 생성 정보 없음';
                        if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                if (executorUser) {
                                    thumbnailComponent = new ThumbnailBuilder({
                                        media: {
                                            url: executorUser.displayAvatarURL({
                                                forceStatic: false,
                                                size: 64,
                                            }),
                                        },
                                    });
                                }
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }

                    case 'guildRoleUpdate': {
                        const roleUpdateDetails = [];
                        const oldRole = data.oldRole as JsonData;
                        const newRole = data.newRole as JsonData;

                        if (newRole?.id) {
                            roleUpdateDetails.push(
                                `**역할:** ${str(newRole.name) || str(oldRole?.name) || 'N/A'} (<@&${str(newRole.id)}>)`,
                            );
                            roleUpdateDetails.push(`**ID:** ${str(newRole.id)}`);
                        } else if (oldRole?.id) {
                            // Fallback if newRole is somehow missing id
                            roleUpdateDetails.push(`**역할 ID:** ${str(oldRole.id, 'ID 없음')}`);
                            if (oldRole.name)
                                roleUpdateDetails.push(`**이전 역할 이름:** ${str(oldRole.name)}`);
                        }

                        if (oldRole && newRole) {
                            if (oldRole.name !== newRole.name) {
                                roleUpdateDetails.push(
                                    `**이름 변경:** \\\`${str(oldRole.name, '(없음)')}\\\` -> \\\`${str(newRole.name, '(없음)')}\\\``,
                                );
                            }
                            if (oldRole.color !== newRole.color) {
                                roleUpdateDetails.push(
                                    `**색상 변경:** \`#${num(oldRole.color).toString(16).padStart(6, '0')}\` -> \`#${num(newRole.color).toString(16).padStart(6, '0')}\``,
                                );
                            }

                            const oldPerms = new PermissionsBitField(
                                BigInt(str(oldRole.permissions, '0')),
                            );
                            const newPerms = new PermissionsBitField(
                                BigInt(str(newRole.permissions, '0')),
                            );
                            if (oldPerms.bitfield !== newPerms.bitfield) {
                                const oldPermArray = oldPerms.toArray();
                                const newPermArray = newPerms.toArray();

                                const addedPerms = newPermArray.filter(
                                    (p) => !oldPermArray.includes(p),
                                );
                                const removedPerms = oldPermArray.filter(
                                    (p) => !newPermArray.includes(p),
                                );

                                if (addedPerms.length > 0)
                                    roleUpdateDetails.push(
                                        `**추가된 권한 (${addedPerms.length}개):** ${addedPerms.slice(0, 3).join(', ')}${addedPerms.length > 3 ? ', ...' : ''}`,
                                    );
                                if (removedPerms.length > 0)
                                    roleUpdateDetails.push(
                                        `**제거된 권한 (${removedPerms.length}개):** ${removedPerms.slice(0, 3).join(', ')}${removedPerms.length > 3 ? ', ...' : ''}`,
                                    );
                            }
                            if (oldRole.hoist !== newRole.hoist) {
                                roleUpdateDetails.push(
                                    `**분리 표시:** ${oldRole.hoist ? '활성' : '비활성'} -> ${newRole.hoist ? '활성' : '비활성'}`,
                                );
                            }
                            if (oldRole.mentionable !== newRole.mentionable) {
                                roleUpdateDetails.push(
                                    `**멘션 가능:** ${oldRole.mentionable ? '활성' : '비활성'} -> ${newRole.mentionable ? '활성' : '비활성'}`,
                                );
                            }
                            if (oldRole.icon !== newRole.icon) {
                                roleUpdateDetails.push(`**아이콘 변경됨**`);
                            }
                            if (oldRole.unicodeEmoji !== newRole.unicodeEmoji) {
                                roleUpdateDetails.push(
                                    `**유니코드 이모지 변경:** ${str(oldRole.unicodeEmoji, '(없음)')} -> ${str(newRole.unicodeEmoji, '(없음)')}`,
                                );
                            }
                        } else if (newRole) {
                            roleUpdateDetails.push('(새 역할 정보만 존재하여 변경 사항 비교 불가)');
                            roleUpdateDetails.push(`**이름:** ${str(newRole.name, 'N/A')}`);
                            if (newRole.color)
                                roleUpdateDetails.push(
                                    `**색상:** #${num(newRole.color).toString(16).padStart(6, '0')}`,
                                );
                        } else if (oldRole) {
                            roleUpdateDetails.push(
                                '(이전 역할 정보만 존재하여 변경 사항 비교 불가)',
                            );
                            roleUpdateDetails.push(`**이름:** ${str(oldRole.name, 'N/A')}`);
                        }

                        eventSpecificsText =
                            roleUpdateDetails.length > 2
                                ? roleUpdateDetails.join('\n')
                                : roleUpdateDetails.length > 0
                                  ? roleUpdateDetails.join('\n') + '\n(세부 변경 사항 감지 안됨)'
                                  : '역할 업데이트 정보 없음';
                        if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                if (executorUser) {
                                    thumbnailComponent = new ThumbnailBuilder({
                                        media: {
                                            url: executorUser.displayAvatarURL({
                                                forceStatic: false,
                                                size: 64,
                                            }),
                                        },
                                    });
                                }
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }

                    case 'guildRoleDelete': {
                        const roleDeleteDetails = [];
                        const role = data.role as JsonData;
                        if (role) {
                            roleDeleteDetails.push(
                                `**삭제된 역할 이름:** ${str(role.name, 'N/A')}`,
                            );
                            if (role.id)
                                roleDeleteDetails.push(`**삭제된 역할 ID:** ${str(role.id)}`);
                        }
                        eventSpecificsText =
                            roleDeleteDetails.length > 0
                                ? roleDeleteDetails.join('\n')
                                : '역할 삭제 정보 없음';
                        if (log.user_id) {
                            try {
                                const executorUser = await interaction.client.users.fetch(
                                    log.user_id,
                                );
                                if (executorUser) {
                                    thumbnailComponent = new ThumbnailBuilder({
                                        media: {
                                            url: executorUser.displayAvatarURL({
                                                forceStatic: false,
                                                size: 64,
                                            }),
                                        },
                                    });
                                }
                            } catch {
                                /* empty */
                            }
                        }
                        break;
                    }
                    // STICKER EVENTS
                    case 'stickerCreate': {
                        const stickerDetails = [];
                        const sticker = (data.sticker ?? data) as JsonData;
                        if (sticker?.id) {
                            stickerDetails.push(`**스티커 이름:** ${str(sticker.name, 'N/A')}`);
                            stickerDetails.push(`**ID:** ${str(sticker.id)}`);
                            const tags = sticker.tags;
                            if (tags)
                                stickerDetails.push(
                                    `**태그:** ${Array.isArray(tags) ? tags.map((t) => str(t)).join(', ') : str(tags)}`,
                                );
                            if (sticker.description)
                                stickerDetails.push(`**설명:** ${str(sticker.description)}`);
                            if (sticker.format_type !== undefined) {
                                // format_type can be 0
                                const formatTypes: Record<number, string> = {
                                    1: 'PNG',
                                    2: 'APNG',
                                    3: 'LOTTIE',
                                    4: 'GIF',
                                };
                                stickerDetails.push(
                                    `**포맷:** ${formatTypes[num(sticker.format_type)] ?? `알 수 없는 포맷 (${str(sticker.format_type)})`}`,
                                );
                            }
                            if (sticker.guildId)
                                stickerDetails.push(`**서버 ID:** ${str(sticker.guildId)}`);
                        }
                        eventSpecificsText =
                            stickerDetails.length > 0
                                ? stickerDetails.join('\\n')
                                : '스티커 생성 정보 없음';
                        if (sticker?.id && sticker.format_type !== 3) {
                            // Lottie stickers don't have a simple image URL via sticker.url
                            try {
                                const fetchedSticker = await interaction.guild?.stickers.fetch(
                                    str(sticker.id),
                                );
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
                        const stickerDetails = [];
                        const oldSticker = data.oldSticker as JsonData;
                        const newSticker = (data.newSticker ?? data.sticker) as JsonData;

                        if (newSticker?.id) {
                            stickerDetails.push(
                                `**스티커:** ${str(newSticker.name, 'N/A')} (ID: ${str(newSticker.id)})`,
                            );
                            if (oldSticker) {
                                if (oldSticker.name !== newSticker.name)
                                    stickerDetails.push(
                                        `**이름 변경:** \\\`${str(oldSticker.name, '(없음)')}\\\` -> \\\`${str(newSticker.name, '(없음)')}\\\``,
                                    );
                                if (oldSticker.description !== newSticker.description)
                                    stickerDetails.push(
                                        `**설명 변경:** \\\`${str(oldSticker.description, '(없음)')}\\\` -> \\\`${str(newSticker.description, '(없음)')}\\\``,
                                    );

                                const oldTags = oldSticker.tags;
                                const newTags = newSticker.tags;
                                const oldTagsText = Array.isArray(oldTags)
                                    ? oldTags.map((t) => str(t)).join(', ')
                                    : str(oldTags, '');
                                const newTagsText = Array.isArray(newTags)
                                    ? newTags.map((t) => str(t)).join(', ')
                                    : str(newTags, '');
                                if (oldTagsText !== newTagsText)
                                    stickerDetails.push(
                                        `**태그 변경:** \\\`${oldTagsText || '(없음)'}\\\` -> \\\`${newTagsText || '(없음)'}\\\``,
                                    );
                            } else {
                                stickerDetails.push('(이전 스티커 정보 없음, 새 정보만 표시)');
                                if (newSticker.description)
                                    stickerDetails.push(`**설명:** ${str(newSticker.description)}`);
                                const newTags = newSticker.tags;
                                if (newTags)
                                    stickerDetails.push(
                                        `**태그:** ${Array.isArray(newTags) ? newTags.map((t) => str(t)).join(', ') : str(newTags)}`,
                                    );
                            }
                        } else {
                            stickerDetails.push('스티커 정보 없음');
                        }
                        eventSpecificsText =
                            stickerDetails.length > 0
                                ? stickerDetails.join('\\n')
                                : '스티커 업데이트 정보 없음';
                        if (newSticker?.id && newSticker.format_type !== 3) {
                            try {
                                const fetchedSticker = await interaction.guild?.stickers.fetch(
                                    str(newSticker.id),
                                );
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
                        const stickerDetails = [];
                        const sticker = (data.sticker ?? data) as JsonData;
                        if (sticker?.id) {
                            stickerDetails.push(
                                `**삭제된 스티커 이름:** ${str(sticker.name, 'N/A')}`,
                            );
                            stickerDetails.push(`**ID:** ${str(sticker.id)}`);
                            const tags = sticker.tags;
                            if (tags)
                                stickerDetails.push(
                                    `**태그:** ${Array.isArray(tags) ? tags.map((t) => str(t)).join(', ') : str(tags)}`,
                                );
                        }
                        eventSpecificsText =
                            stickerDetails.length > 0
                                ? stickerDetails.join('\\n')
                                : '스티커 삭제 정보 없음';
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
                        const emojiDetails = [];
                        const emoji = (data.emoji ?? data) as JsonData;
                        if (emoji?.id) {
                            emojiDetails.push(`**이모지 이름:** ${str(emoji.name, 'N/A')}`);
                            emojiDetails.push(`**ID:** ${str(emoji.id)}`);
                            emojiDetails.push(`**표시:** <:${str(emoji.name)}:${str(emoji.id)}>`);
                            if (emoji.animated) emojiDetails.push(`**애니메이션됨:** 예`);
                        }
                        eventSpecificsText =
                            emojiDetails.length > 0
                                ? emojiDetails.join('\\n')
                                : '이모지 생성 정보 없음';
                        if (emoji?.id) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/emojis/${str(emoji.id)}.${emoji.animated ? 'gif' : 'png'}?size=64`,
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
                        const emojiDetails = [];
                        const oldEmoji = data.oldEmoji as JsonData;
                        const newEmoji = (data.newEmoji ?? data.emoji) as JsonData;
                        if (newEmoji?.id) {
                            emojiDetails.push(
                                `**이모지:** ${str(newEmoji.name, 'N/A')} (ID: ${str(newEmoji.id)}) <:${str(newEmoji.name)}:${str(newEmoji.id)}>`,
                            );
                            if (oldEmoji) {
                                if (oldEmoji.name !== newEmoji.name) {
                                    emojiDetails.push(
                                        `**이름 변경:** \\\`${str(oldEmoji.name)}\\\` -> \\\`${str(newEmoji.name)}\\\``,
                                    );
                                }
                            } else {
                                emojiDetails.push('(이전 이모지 정보 없음)');
                            }
                        } else {
                            emojiDetails.push('이모지 정보 없음');
                        }
                        eventSpecificsText =
                            emojiDetails.length > 0
                                ? emojiDetails.join('\\n')
                                : '이모지 업데이트 정보 없음';
                        if (newEmoji?.id) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/emojis/${str(newEmoji.id)}.${newEmoji.animated ? 'gif' : 'png'}?size=64`,
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
                        const emojiDetails = [];
                        const emoji = (data.emoji ?? data) as JsonData;
                        if (emoji?.id) {
                            emojiDetails.push(`**삭제된 이모지 이름:** ${str(emoji.name, 'N/A')}`);
                            emojiDetails.push(`**ID:** ${str(emoji.id)}`);
                        }
                        eventSpecificsText =
                            emojiDetails.length > 0
                                ? emojiDetails.join('\\n')
                                : '이모지 삭제 정보 없음';
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
                        const banDetails = [];
                        const user =
                            (data.user as JsonData | undefined) ??
                            ((data.userId
                                ? { id: data.userId, tag: data.userTag }
                                : null) as JsonData | null);
                        const reason = data.reason;
                        const executor = data.executor as JsonData | undefined;

                        if (user) {
                            banDetails.push(
                                `**사용자:** ${str(user.tag) || `<@${str(user.id)}>`} (${str(user.id)})`,
                            );
                        } else if (data.userId) {
                            banDetails.push(`**사용자 ID:** ${str(data.userId)}`);
                        }
                        if (reason) {
                            banDetails.push(
                                `**사유:** ${str(reason).substring(0, 200)}${str(reason).length > 200 ? '...' : ''}`,
                            );
                        }
                        if (executor?.id) {
                            banDetails.push(
                                `**실행자:** ${str(executor.tag) || `<@${str(executor.id)}>`} (${str(executor.id)})`,
                            );
                        } else if (log.user_id && executor?.id !== log.user_id) {
                            try {
                                const execUser = await interaction.client.users.fetch(log.user_id);
                                banDetails.push(
                                    `**실행자 (로깅):** ${execUser.tag} (<@${log.user_id}>)`,
                                );
                            } catch {
                                banDetails.push(`**실행자 ID (로깅):** ${str(log.user_id)}`);
                            }
                        }
                        eventSpecificsText =
                            banDetails.length > 0 ? banDetails.join('\\n') : '서버 차단 정보 없음';
                        if (user?.id) {
                            try {
                                const bannedUser = await interaction.client.users.fetch(
                                    str(user.id),
                                );
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
                        const unbanDetails = [];
                        const user =
                            (data.user as JsonData | undefined) ??
                            ((data.userId
                                ? { id: data.userId, tag: data.userTag }
                                : null) as JsonData | null);
                        const executor = data.executor as JsonData | undefined;

                        if (user) {
                            unbanDetails.push(
                                `**사용자:** ${str(user.tag) || `<@${str(user.id)}>`} (${str(user.id)})`,
                            );
                        } else if (data.userId) {
                            unbanDetails.push(`**사용자 ID:** ${str(data.userId)}`);
                        }
                        if (executor?.id) {
                            unbanDetails.push(
                                `**실행자:** ${str(executor.tag) || `<@${str(executor.id)}>`} (${str(executor.id)})`,
                            );
                        } else if (log.user_id && executor?.id !== log.user_id) {
                            try {
                                const execUser = await interaction.client.users.fetch(log.user_id);
                                unbanDetails.push(
                                    `**실행자 (로깅):** ${execUser.tag} (<@${log.user_id}>)`,
                                );
                            } catch {
                                unbanDetails.push(`**실행자 ID (로깅):** ${str(log.user_id)}`);
                            }
                        }
                        eventSpecificsText =
                            unbanDetails.length > 0
                                ? unbanDetails.join('\\n')
                                : '서버 차단 해제 정보 없음';
                        if (user?.id) {
                            try {
                                const unbannedUser = await interaction.client.users.fetch(
                                    str(user.id),
                                );
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
                        const eventDetails = [];
                        const event = (data.scheduledEvent ?? data) as JsonData;
                        if (event) {
                            eventDetails.push(`**이벤트 이름:** ${str(event.name, 'N/A')}`);
                            if (event.id) eventDetails.push(`**ID:** ${str(event.id)}`);
                            if (event.description)
                                eventDetails.push(
                                    `**설명:** ${str(event.description).substring(0, 100)}${str(event.description).length > 100 ? '...' : ''}`,
                                );
                            if (event.scheduledStartTime)
                                eventDetails.push(
                                    `**시작 시간:** <t:${Math.floor(new Date(str(event.scheduledStartTime)).getTime() / 1000)}:F>`,
                                );
                            if (event.scheduledEndTime)
                                eventDetails.push(
                                    `**종료 시간:** <t:${Math.floor(new Date(str(event.scheduledEndTime)).getTime() / 1000)}:F>`,
                                );
                            if (event.entityType !== undefined) {
                                if (event.entityType !== undefined) {
                                    const types: Record<number, string> = {
                                        1: '스테이지',
                                        2: '음성 채널',
                                        3: '외부 링크',
                                    };
                                    eventDetails.push(
                                        `**유형:** ${types[num(event.entityType)] ?? `알 수 없음 (${str(event.entityType)})`}`,
                                    );
                                }
                            }
                            if (event.channelId)
                                eventDetails.push(`**채널:** <#${str(event.channelId)}>`);
                            else if ((event.entityMetadata as JsonData)?.location)
                                eventDetails.push(
                                    `**위치:** ${str((event.entityMetadata as JsonData).location)}`,
                                );
                            if (event.creatorId) {
                                try {
                                    const creator = await interaction.client.users.fetch(
                                        str(event.creatorId),
                                    );
                                    eventDetails.push(
                                        `**생성자:** ${creator.tag} (<@${str(event.creatorId)}>)`,
                                    );
                                } catch {
                                    eventDetails.push(`**생성자 ID:** ${str(event.creatorId)}`);
                                }
                            }
                        }
                        eventSpecificsText =
                            eventDetails.length > 0
                                ? eventDetails.join('\\n')
                                : '예약된 이벤트 생성 정보 없음';
                        if (event?.id && event.image) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/guild-events/${str(event.id)}/${str(event.image)}.png?size=64`,
                                },
                            });
                        } else if (event?.creatorId) {
                            try {
                                const creator = await interaction.client.users.fetch(
                                    str(event.creatorId),
                                );
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
                        const eventDetails = [];
                        const oldEvent = data.oldScheduledEvent as JsonData | undefined;
                        const newEvent = (data.newScheduledEvent ?? data.scheduledEvent) as
                            | JsonData
                            | undefined;

                        if (newEvent) {
                            eventDetails.push(
                                `**이벤트:** ${str(newEvent.name, 'N/A')} (ID: ${str(newEvent.id, '정보 없음')})`,
                            );
                            if (oldEvent) {
                                if (oldEvent.name !== newEvent.name)
                                    eventDetails.push(
                                        `**이름 변경:** \\\`${str(oldEvent.name)}\\\` -> \\\`${str(newEvent.name)}\\\``,
                                    );
                                if (oldEvent.description !== newEvent.description)
                                    eventDetails.push(
                                        `**설명 변경:** \\\`${str(oldEvent.description, '').substring(0, 30)}...\\\` -> \\\`${str(newEvent.description, '').substring(0, 30)}...\\\``,
                                    );
                                if (
                                    new Date(str(oldEvent.scheduledStartTime)).getTime() !==
                                    new Date(str(newEvent.scheduledStartTime)).getTime()
                                )
                                    eventDetails.push(
                                        `**시작 시간 변경:** <t:${Math.floor(new Date(str(oldEvent.scheduledStartTime)).getTime() / 1000)}:R> -> <t:${Math.floor(new Date(str(newEvent.scheduledStartTime)).getTime() / 1000)}:R>`,
                                    );
                                if (oldEvent.status !== newEvent.status) {
                                    const statuses: Record<number, string> = {
                                        1: '예정',
                                        2: '활성',
                                        3: '완료됨',
                                        4: '취소됨',
                                    };
                                    eventDetails.push(
                                        `**상태 변경:** ${statuses[num(oldEvent.status)] ?? `상태 ${str(oldEvent.status)}`} -> ${statuses[num(newEvent.status)] ?? `상태 ${str(newEvent.status)}`}`,
                                    );
                                }
                                if (oldEvent.entityType !== newEvent.entityType) {
                                    const types: Record<number, string> = {
                                        1: '스테이지',
                                        2: '음성 채널',
                                        3: '외부 링크',
                                    };
                                    eventDetails.push(
                                        `**유형 변경:** ${types[num(oldEvent.entityType)] ?? `타입 ${str(oldEvent.entityType)}`} -> ${types[num(newEvent.entityType)] ?? `타입 ${str(newEvent.entityType)}`}`,
                                    );
                                }
                                // Could add channel/location changes
                            } else {
                                eventDetails.push('(이전 이벤트 정보 없음)');
                            }
                        } else {
                            eventDetails.push('예약된 이벤트 정보 없음');
                        }
                        eventSpecificsText =
                            eventDetails.length > 0
                                ? eventDetails.join('\\n')
                                : '예약된 이벤트 업데이트 정보 없음';
                        if (newEvent?.id && newEvent.image) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/guild-events/${str(newEvent.id)}/${str(newEvent.image)}.png?size=64`,
                                },
                            });
                        } else if (newEvent?.creatorId) {
                            try {
                                const creator = await interaction.client.users.fetch(
                                    str(newEvent.creatorId),
                                );
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
                        const eventDetails = [];
                        const event = (data.scheduledEvent ?? data) as JsonData;
                        if (event) {
                            eventDetails.push(`**삭제된 이벤트 이름:** ${str(event.name, 'N/A')}`);
                            if (event.id) eventDetails.push(`**ID:** ${str(event.id)}`);
                            if (event.creatorId) {
                                try {
                                    const creator = await interaction.client.users.fetch(
                                        str(event.creatorId),
                                    );
                                    eventDetails.push(
                                        `**생성자:** ${creator.tag} (<@${str(event.creatorId)}>)`,
                                    );
                                } catch {
                                    eventDetails.push(`**생성자 ID:** ${str(event.creatorId)}`);
                                }
                            }
                        }
                        eventSpecificsText =
                            eventDetails.length > 0
                                ? eventDetails.join('\\n')
                                : '예약된 이벤트 삭제 정보 없음';
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
                        const details = [];
                        const eventId = str(data.scheduledEventId ?? data.eventId);
                        const userId = str(data.userId);
                        const eventName = str(data.eventName); // Assuming logger includes eventName

                        if (eventName) details.push(`**이벤트:** ${eventName}`);
                        else if (eventId) details.push(`**이벤트 ID:** ${eventId}`);

                        if (userId) details.push(`**참가 사용자:** <@${userId}> (${userId})`);

                        // Try to fetch event name if not logged and guild is available
                        const guild = interaction.guild;
                        if (eventId && !eventName && guild) {
                            try {
                                const guildEvent = await guild.scheduledEvents.fetch(eventId);
                                if (guildEvent) {
                                    if (guildEvent.name) {
                                        details.unshift(`**이벤트:** ${guildEvent.name}`);
                                    } else if (guildEvent.id) {
                                        details.unshift(
                                            `**이벤트 ID (이름 조회 불가):** ${guildEvent.id}`,
                                        );
                                    }
                                }
                            } catch {
                                /* Failed to fetch event name, or eventId was invalid */
                            }
                        }
                        eventSpecificsText =
                            details.length > 0
                                ? details.join('\\n')
                                : '예약된 이벤트 사용자 추가 정보 없음';
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
                        } else if (
                            (data.guildScheduledEvent as JsonData)?.image &&
                            (data.guildScheduledEvent as JsonData)?.id
                        ) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/guild-events/${str((data.guildScheduledEvent as JsonData).id)}/${str((data.guildScheduledEvent as JsonData).image)}.png?size=64`,
                                },
                            });
                        }
                        break;
                    }
                    case 'guildScheduledEventUserRemove': {
                        const details = [];
                        const eventId = str(data.scheduledEventId ?? data.eventId);
                        const userId = str(data.userId);
                        const eventName = str(data.eventName);

                        if (eventName) details.push(`**이벤트:** ${eventName}`);
                        else if (eventId) details.push(`**이벤트 ID:** ${eventId}`);

                        if (userId) details.push(`**이탈 사용자:** <@${userId}> (${userId})`);

                        const guild = interaction.guild; // Ensure guild context
                        if (eventId && !eventName && guild) {
                            try {
                                const guildEvent = await guild.scheduledEvents.fetch(eventId);
                                if (guildEvent) {
                                    if (guildEvent.name) {
                                        details.unshift(`**이벤트:** ${guildEvent.name}`);
                                    } else if (guildEvent.id) {
                                        details.unshift(
                                            `**이벤트 ID (이름 조회 불가):** ${guildEvent.id}`,
                                        );
                                    }
                                }
                            } catch {
                                /* Failed to fetch event name, or eventId was invalid */
                            }
                        }
                        eventSpecificsText =
                            details.length > 0
                                ? details.join('\\n')
                                : '예약된 이벤트 사용자 제거 정보 없음';
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
                        } else if (
                            (data.guildScheduledEvent as JsonData)?.image &&
                            (data.guildScheduledEvent as JsonData)?.id
                        ) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/guild-events/${str((data.guildScheduledEvent as JsonData).id)}/${str((data.guildScheduledEvent as JsonData).image)}.png?size=64`,
                                },
                            });
                        }
                        break;
                    }

                    // INVITE EVENTS
                    case 'inviteCreate': {
                        const inviteDetails = [];
                        const invite = (data.invite ?? data) as JsonData;
                        if (invite) {
                            if (invite.code)
                                inviteDetails.push(`**초대 코드:** ${str(invite.code)}`);
                            if (invite.url) inviteDetails.push(`**URL:** ${str(invite.url)}`);
                            const inviterId = str(
                                invite.inviterId ?? (invite.inviter as JsonData)?.id,
                            );
                            const inviterTag =
                                str((invite.inviter as JsonData)?.tag) ||
                                (inviterId ? `<@${inviterId}>` : null);
                            if (inviterId) {
                                try {
                                    const inviterUser =
                                        await interaction.client.users.fetch(inviterId);
                                    inviteDetails.push(
                                        `**생성자:** ${inviterUser.tag} (<@${inviterId}>)`,
                                    );
                                } catch {
                                    inviteDetails.push(`**생성자:** ${inviterTag ?? inviterId}`);
                                }
                            }
                            const channelId = str(
                                invite.channelId ?? (invite.channel as JsonData)?.id,
                            );
                            if (channelId) inviteDetails.push(`**채널:** <#${channelId}>`);
                            if (invite.uses !== undefined)
                                inviteDetails.push(`**사용 횟수:** ${num(invite.uses)}`);
                            if (invite.maxUses !== undefined)
                                inviteDetails.push(
                                    `**최대 사용:** ${num(invite.maxUses) === 0 ? '무제한' : num(invite.maxUses)}`,
                                );
                            if (invite.maxAge !== undefined)
                                inviteDetails.push(
                                    `**만료:** ${num(invite.maxAge) === 0 ? '없음' : `${num(invite.maxAge) / 60 / 60}시간`}`,
                                );
                            if (invite.temporary !== undefined)
                                inviteDetails.push(
                                    `**임시 멤버십:** ${invite.temporary ? '예' : '아니오'}`,
                                );
                            if (invite.createdAt)
                                inviteDetails.push(
                                    `**생성일:** <t:${Math.floor(new Date(str(invite.createdAt)).getTime() / 1000)}:R>`,
                                );
                        }
                        eventSpecificsText =
                            inviteDetails.length > 0
                                ? inviteDetails.join('\\n')
                                : '초대 생성 정보 없음';
                        const inviterIdForThumbnail = str(
                            invite?.inviterId ?? (invite?.inviter as JsonData)?.id,
                        );
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
                        const inviteDetails = [];
                        const invite = (data.invite ?? data) as JsonData;
                        if (invite) {
                            if (invite.code)
                                inviteDetails.push(`**삭제된 초대 코드:** ${str(invite.code)}`);
                            const channelId = str(
                                invite.channelId ?? (invite.channel as JsonData)?.id,
                            );
                            if (channelId) inviteDetails.push(`**채널:** <#${channelId}>`);
                        }
                        eventSpecificsText =
                            inviteDetails.length > 0
                                ? inviteDetails.join('\\n')
                                : '초대 삭제 정보 없음';
                        if (log.user_id) {
                            try {
                                const user = await interaction.client.users.fetch(str(log.user_id));
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
                        const guildChanges = [];
                        const oldGuild = data.oldGuild as JsonData;
                        const newGuild = (data.newGuild ?? data.guild) as JsonData;

                        if (!oldGuild || !newGuild) {
                            eventSpecificsText = '길드 업데이트 정보 부족 (이전 또는 새 상태 누락)';
                            break;
                        }

                        guildChanges.push(
                            `**"${str(newGuild.name) || str(oldGuild.name)}" 설정 변경**`,
                        );

                        if (oldGuild.name !== newGuild.name)
                            guildChanges.push(
                                `**이름:** \\\`${str(oldGuild.name)}\\\` -> \\\`${str(newGuild.name)}\\\``,
                            );
                        if (oldGuild.icon !== newGuild.icon) guildChanges.push(`**아이콘 변경됨**`);
                        if (oldGuild.splash !== newGuild.splash)
                            guildChanges.push(`**초대 배경 변경됨**`);
                        if (oldGuild.discoverySplash !== newGuild.discoverySplash)
                            guildChanges.push(`**탐색 스플래시 변경됨**`);
                        if (oldGuild.banner !== newGuild.banner)
                            guildChanges.push(`**배너 변경됨**`);
                        if (oldGuild.ownerId !== newGuild.ownerId) {
                            try {
                                const oldOwnerUser = oldGuild.ownerId
                                    ? await interaction.client.users.fetch(str(oldGuild.ownerId))
                                    : null;
                                const newOwnerUser = newGuild.ownerId
                                    ? await interaction.client.users.fetch(str(newGuild.ownerId))
                                    : null;
                                guildChanges.push(
                                    `**소유자:** ${oldOwnerUser?.tag ?? str(oldGuild.ownerId)} -> ${newOwnerUser?.tag ?? str(newGuild.ownerId)}`,
                                );
                            } catch {
                                guildChanges.push(
                                    `**소유자 ID:** ${str(oldGuild.ownerId)} -> ${str(newGuild.ownerId)}`,
                                );
                            }
                        }
                        if (oldGuild.afkChannelId !== newGuild.afkChannelId)
                            guildChanges.push(
                                `**자리비움 채널:** ${oldGuild.afkChannelId ? `<#${str(oldGuild.afkChannelId)}>` : '없음'} -> ${newGuild.afkChannelId ? `<#${str(newGuild.afkChannelId)}>` : '없음'}`,
                            );
                        if (oldGuild.afkTimeout !== newGuild.afkTimeout)
                            guildChanges.push(
                                `**자리비움 시간:** ${num(oldGuild.afkTimeout) / 60}분 -> ${num(newGuild.afkTimeout) / 60}분`,
                            );
                        if (oldGuild.systemChannelId !== newGuild.systemChannelId)
                            guildChanges.push(
                                `**시스템 채널:** ${oldGuild.systemChannelId ? `<#${str(oldGuild.systemChannelId)}>` : '없음'} -> ${newGuild.systemChannelId ? `<#${str(newGuild.systemChannelId)}>` : '없음'}`,
                            );
                        if (oldGuild.verificationLevel !== newGuild.verificationLevel)
                            guildChanges.push(
                                `**인증 수준 변경됨** (L${str(oldGuild.verificationLevel)} -> L${str(newGuild.verificationLevel)})`,
                            );
                        if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter)
                            guildChanges.push(
                                `**콘텐츠 필터 변경됨** (L${str(oldGuild.explicitContentFilter)} -> L${str(newGuild.explicitContentFilter)})`,
                            );
                        if (oldGuild.mfaLevel !== newGuild.mfaLevel)
                            guildChanges.push(
                                `**2FA 요구사항 변경됨** (L${str(oldGuild.mfaLevel)} -> L${str(newGuild.mfaLevel)})`,
                            );
                        if (oldGuild.vanityURLCode !== newGuild.vanityURLCode)
                            guildChanges.push(
                                `** Vanity URL:** \\\`${str(oldGuild.vanityURLCode, '없음')}\\\` -> \\\`${str(newGuild.vanityURLCode, '없음')}\\\``,
                            );
                        if (oldGuild.description !== newGuild.description)
                            guildChanges.push(
                                `**설명 변경:** \\\`${str(oldGuild.description, '').substring(0, 30)}...\\\` -> \\\`${str(newGuild.description, '').substring(0, 30)}...\\\``,
                            );
                        if (oldGuild.preferredLocale !== newGuild.preferredLocale)
                            guildChanges.push(
                                `**기본 언어:** ${str(oldGuild.preferredLocale)} -> ${str(newGuild.preferredLocale)}`,
                            );

                        eventSpecificsText =
                            guildChanges.length > 1
                                ? guildChanges.join('\\n')
                                : `서버 설정 변경됨 (세부사항 확인 필요)`;

                        const guildForIcon = interaction.guild; // Use current guild state for icon
                        if (guildForIcon?.iconURL()) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: guildForIcon.iconURL({ forceStatic: false, size: 64 })!,
                                },
                            });
                        } else if (newGuild.icon) {
                            thumbnailComponent = new ThumbnailBuilder({
                                media: {
                                    url: `https://cdn.discordapp.com/icons/${str(newGuild.id)}/${str(newGuild.icon)}.png?size=64`,
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

                    // CHANNEL EVENTS (TEXT, VOICE, CATEGORY, ETC.)
                    case 'channelCreate': {
                        const details = [];
                        const channel = (data.channel ?? data) as JsonData;
                        if (channel) {
                            details.push(
                                `**채널 이름:** ${str(channel.name, 'N/A')} (<#${str(channel.id, 'ID 없음')}>)`,
                            );
                            if (channel.id) details.push(`**ID:** ${str(channel.id)}`);
                            const typeText =
                                channel.type !== undefined
                                    ? (ChannelType[num(channel.type)] ??
                                      `타입 ${str(channel.type)}`)
                                    : '알 수 없음';
                            details.push(`**타입:** ${typeText}`);
                            if (channel.parentId)
                                details.push(`**카테고리:** <#${str(channel.parentId)}>`);
                            if (channel.topic)
                                details.push(
                                    `**주제:** ${str(channel.topic).substring(0, 100)}${str(channel.topic).length > 100 ? '...' : ''}`,
                                );
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\\n') : '채널 생성 정보 없음';
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
                    case 'channelDelete': {
                        const details = [];
                        const channel = (data.channel ?? data) as JsonData;
                        if (channel) {
                            details.push(`**삭제된 채널 이름:** ${str(channel.name, 'N/A')}`);
                            if (channel.id) details.push(`**ID:** ${str(channel.id)}`);
                            const typeText =
                                channel.type !== undefined
                                    ? (ChannelType[num(channel.type)] ??
                                      `타입 ${str(channel.type)}`)
                                    : '알 수 없음';
                            details.push(`**타입:** ${typeText}`);
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\\n') : '채널 삭제 정보 없음';
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
                        const details = [];
                        const oldChannel = data.oldChannel as JsonData | undefined;
                        const newChannel = (data.newChannel ?? data.channel) as
                            | JsonData
                            | undefined;
                        if (newChannel) {
                            details.push(
                                `**채널:** ${str(newChannel.name, 'N/A')} (<#${str(newChannel.id, 'ID 없음')}>)`,
                            );
                            if (oldChannel) {
                                if (oldChannel.name !== newChannel.name)
                                    details.push(
                                        `**이름 변경:** \\\`${str(oldChannel.name)}\\\` -> \\\`${str(newChannel.name)}\\\``,
                                    );
                                if (oldChannel.topic !== newChannel.topic)
                                    details.push(
                                        `**주제 변경:** \\\`${str(oldChannel.topic, '').substring(0, 30)}...\\\` -> \\\`${str(newChannel.topic, '').substring(0, 30)}...\\\``,
                                    );
                                if (oldChannel.parentId !== newChannel.parentId)
                                    details.push(
                                        `**카테고리 변경:** ${oldChannel.parentId ? `<#${str(oldChannel.parentId)}>` : '없음'} -> ${newChannel.parentId ? `<#${str(newChannel.parentId)}>` : '없음'}`,
                                    );
                                if (oldChannel.type !== newChannel.type)
                                    details.push(
                                        `**타입 변경:** ${ChannelType[num(oldChannel.type)]} -> ${ChannelType[num(newChannel.type)]}`,
                                    );
                                if (oldChannel.nsfw !== newChannel.nsfw)
                                    details.push(
                                        `**NSFW:** ${oldChannel.nsfw ? '예' : '아니오'} -> ${newChannel.nsfw ? '예' : '아니오'}`,
                                    );
                                if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser)
                                    details.push(
                                        `**슬로우 모드:** ${num(oldChannel.rateLimitPerUser) || 0}초 -> ${num(newChannel.rateLimitPerUser) || 0}초`,
                                    );
                            } else {
                                details.push('(이전 채널 정보 없음)');
                            }
                        } else {
                            details.push('채널 정보 없음');
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\\n') : '채널 업데이트 정보 없음';
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
                        const details = [];
                        const channelId = str(data.channelId ?? (data.channel as JsonData)?.id);
                        const lastPinTimestamp = str(data.lastPinTimestamp ?? data.timestamp); // timestamp of the event itself as fallback

                        if (channelId) details.push(`**채널:** <#${channelId}>`);
                        if (lastPinTimestamp) {
                            details.push(
                                `**마지막 고정 시간:** <t:${Math.floor(new Date(lastPinTimestamp).getTime() / 1000)}:F>`,
                            );
                        } else {
                            details.push('채널 고정핀 업데이트됨');
                        }
                        eventSpecificsText = details.join('\\n');
                        if (log.user_id) {
                            // User who (un)pinned, if available from audit logs
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
                        const details = [];
                        const thread = (data.thread ?? data) as JsonData;
                        if (thread) {
                            details.push(
                                `**스레드 이름:** ${str(thread.name, 'N/A')} (<#${str(thread.id, 'ID 없음')}>)`,
                            );
                            if (thread.id) details.push(`**ID:** ${str(thread.id)}`);
                            if (thread.parentId)
                                details.push(`**상위 채널:** <#${str(thread.parentId)}>`);
                            if (thread.ownerId) {
                                try {
                                    const owner = await interaction.client.users.fetch(
                                        str(thread.ownerId),
                                    );
                                    details.push(
                                        `**생성자:** ${owner.tag} (<@${str(thread.ownerId)}>)`,
                                    );
                                } catch {
                                    details.push(`**생성자 ID:** ${str(thread.ownerId)}`);
                                }
                            }
                            if (thread.autoArchiveDuration)
                                details.push(
                                    `**자동 보관:** ${num(thread.autoArchiveDuration) / 60}분`,
                                ); // in minutes
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\\n') : '스레드 생성 정보 없음';
                        if (thread?.ownerId) {
                            try {
                                const owner = await interaction.client.users.fetch(
                                    str(thread.ownerId),
                                );
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
                        const details = [];
                        const thread = (data.thread ?? data) as JsonData;
                        if (thread) {
                            details.push(`**삭제된 스레드 이름:** ${str(thread.name, 'N/A')}`);
                            if (thread.id) details.push(`**ID:** ${str(thread.id)}`);
                            if (thread.parentId)
                                details.push(`**상위 채널:** <#${str(thread.parentId)}>`);
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\\n') : '스레드 삭제 정보 없음';
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
                        const details = [];
                        const oldThread = data.oldThread as JsonData | undefined;
                        const newThread = (data.newThread ?? data.thread) as JsonData | undefined;
                        if (newThread) {
                            details.push(
                                `**스레드:** ${str(newThread.name, 'N/A')} (<#${str(newThread.id, 'ID 없음')}>)`,
                            );
                            if (oldThread) {
                                if (oldThread.name !== newThread.name)
                                    details.push(
                                        `**이름 변경:** \\\`${str(oldThread.name)}\\\` -> \\\`${str(newThread.name)}\\\``,
                                    );
                                if (oldThread.archived !== newThread.archived)
                                    details.push(
                                        `**보관 상태:** ${oldThread.archived ? '보관됨' : '활성'} -> ${newThread.archived ? '보관됨' : '활성'}`,
                                    );
                                if (oldThread.locked !== newThread.locked)
                                    details.push(
                                        `**잠금 상태:** ${oldThread.locked ? '잠김' : '해제'} -> ${newThread.locked ? '잠김' : '해제'}`,
                                    );
                                if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration)
                                    details.push(
                                        `**자동 보관 변경:** ${num(oldThread.autoArchiveDuration) / 60}분 -> ${num(newThread.autoArchiveDuration) / 60}분`,
                                    );
                            } else {
                                details.push('(이전 스레드 정보 없음)');
                            }
                        } else {
                            details.push('스레드 정보 없음');
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\\n') : '스레드 업데이트 정보 없음';
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
                        const details = [];
                        const oldUser = data.oldUser as JsonData | undefined;
                        const newUser = (data.newUser ?? data.user) as JsonData | undefined;
                        if (newUser) {
                            details.push(
                                `**사용자:** ${str(newUser.tag) || str(newUser.username)} (<@${str(newUser.id)}>)`,
                            );
                            if (oldUser) {
                                if (oldUser.username !== newUser.username)
                                    details.push(
                                        `**사용자명 변경:** \\\`${str(oldUser.username)}\\\` -> \\\`${str(newUser.username)}\\\``,
                                    );
                                if (oldUser.discriminator !== newUser.discriminator)
                                    details.push(
                                        `**태그 변경:** #${str(oldUser.discriminator)} -> #${str(newUser.discriminator)}`,
                                    );
                                if (oldUser.avatar !== newUser.avatar)
                                    details.push(`**아바타 변경됨**`);
                                // globalName, banner
                                if (oldUser.globalName !== newUser.globalName)
                                    details.push(
                                        `**표시 이름 변경:** \\\`${str(oldUser.globalName, '(없음)')}\\\` -> \\\`${str(newUser.globalName, '(없음)')}\\\``,
                                    );
                            }
                        } else {
                            details.push('사용자 정보 없음');
                        }
                        eventSpecificsText =
                            details.length > 0 ? details.join('\\n') : '사용자 업데이트 정보 없음';
                        if (newUser?.id) {
                            try {
                                const updatedUser = await interaction.client.users.fetch(
                                    str(newUser.id),
                                );
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
                        const details = [];
                        const oldState = data.oldState as JsonData | undefined;
                        const newState = (data.newState ?? data.state) as JsonData | undefined;
                        const member = (data.member ?? newState?.member ?? oldState?.member) as
                            | JsonData
                            | undefined;
                        const userId = str(newState?.id ?? oldState?.id ?? member?.id); // member id from voice state
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

                        eventSpecificsText = details.join('\\n');
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

            const eventData = log.event_data as JsonData;
            if (eventData && Array.isArray(eventData.attachments)) {
                for (const item of eventData.attachments) {
                    const attachmentData = item;
                    const storagePath = str(attachmentData.storagePath);
                    if (storagePath && attachmentData.filename) {
                        let nasFileBuffer: Buffer | null = null;
                        try {
                            nasFileBuffer = await storageManager.download(storagePath);
                        } catch {
                            // Suppress error if file not found or download failed, similar to previous behavior
                            // logger.warn(`Failed to download attachment: ${attachmentData.storagePath}`, error);
                        }
                        if (nasFileBuffer) {
                            const uniqueAttachmentFilename =
                                `${log.id}_${str(attachmentData.id)}_${str(attachmentData.filename)}`.replace(
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
                            const attText = `📎 [${str(attachmentData.filename) || '첨부파일'} (다운로드 실패)](${str(attachmentData.discordUrl)})`;
                            if (currentTextSize + attText.length > MAX_TEXT_SIZE) break;
                            currentTextSize += attText.length;
                            displayableComponents.push(
                                new TextDisplayBuilder().setContent(attText),
                            );
                        }
                    } else if (attachmentData.discordUrl) {
                        const attText = `📎 [${str(attachmentData.filename) || '첨부파일'}](${str(attachmentData.discordUrl)})`;
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
        const rawEventType = interaction.options.getString('event-type'); // 사용자가 선택/입력한 값

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
            eventType: validatedEventType, // 검증된 이벤트 타입 사용
            noOptionsProvidedInitially,
        };

        // 첫 페이지 로드
        await fetchAndDisplayLogs(interaction, 0, initialSearchParams, false, 0);

        // 기존 메시지에 대한 콜렉터 설정
        // ephemeral 메시지는 기본적으로 컴포넌트 콜렉터를 오래 유지하기 어려울 수 있음 (사용자 경험 고려)
        try {
            const message = await interaction.fetchReply();
            const collector = message.createMessageComponentCollector({
                filter: (i: MessageComponentInteraction) =>
                    i.customId.startsWith('log_search_') && i.user.id === interaction.user.id,
                componentType: ComponentType.Button,
                time: 15 * 60 * 1000, // 15분으로 연장
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
                    } else if (action === 'pageinfo') {
                        // pageinfo 버튼은 아무것도 하지 않음 (이미 disabled 상태)
                    } else {
                        logger.warn(`Unknown button action or invalid offset: ${i.customId}`);
                    }
                })();
            });
        } catch (fetchReplyError) {
            logger.error('Failed to fetch reply for collector setup:', fetchReplyError);
            // 초기 fetchAndDisplayLogs 에서 오류가 발생하면 이미 editReply로 응답했을 수 있음.
            // 이 경우 추가적인 오류 메시지 전송은 자제.
        }
    },
};

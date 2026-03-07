import {
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';

import { getInteractionLocale, t } from '../deps.js';
import { str } from '../formatters.js';
import { isJsonData } from '../types.js';

import type { JsonData, JsonValue, LogEntry } from '../deps.js';

interface RenderMemberEventParams {
    interaction: ChatInputCommandInteraction | MessageComponentInteraction;
    log: LogEntry;
    eventType: string;
    eventData: JsonValue | undefined;
    thumbnailComponent: ThumbnailBuilder;
}

interface RenderMemberEventResult {
    eventSpecificsText: string;
    thumbnailComponent: ThumbnailBuilder;
}

/**
 * 역할 배열 데이터를 `roleId -> roleName` 맵으로 정규화합니다.
 */
function getRoleMap(rolesData: JsonValue | undefined): Map<string, string | undefined> {
    const map = new Map<string, string | undefined>();
    if (isJsonData(rolesData) && isJsonData(rolesData.cache)) {
        // d.js RoleManager structure - unlikely in serialized JSONB but handle gracefully
        if (typeof rolesData.cache.forEach === 'function') {
            return map;
        }
    } else if (Array.isArray(rolesData)) {
        for (const role of rolesData) {
            if (typeof role === 'string') {
                map.set(role, undefined);
            } else if (isJsonData(role) && role.id) {
                map.set(str(role.id), typeof role.name === 'string' ? role.name : undefined);
            }
        }
    }
    return map;
}

/**
 * 멤버 관련 이벤트 데이터를 읽어 상세 텍스트와 썸네일을 구성합니다.
 */
export async function renderEvent({
    interaction,
    log,
    eventType,
    eventData,
    thumbnailComponent,
}: RenderMemberEventParams): Promise<RenderMemberEventResult> {
    const locale = getInteractionLocale(interaction);
    let eventSpecificsText = t(locale, 'logSearchShared.legacy.noContent');
    let nextThumbnailComponent = thumbnailComponent;

    if (!isJsonData(eventData)) {
        return {
            eventSpecificsText,
            thumbnailComponent: nextThumbnailComponent,
        };
    }

    switch (eventType) {
        case 'guildMemberAdd': {
            const memberAddDetails: string[] = [];
            if (eventData.memberTag) {
                memberAddDetails.push(
                    `${t(locale, 'logSearchShared.legacy.userLabel')} ${str(eventData.memberTag)} (${str(eventData.memberId, t(locale, 'logSearchShared.role.idMissing'))})`,
                );
            } else if (eventData.memberId) {
                memberAddDetails.push(
                    `${t(locale, 'logSearchShared.legacy.userIdLabel')} ${str(eventData.memberId)}`,
                );
            }

            if (eventData.inviterId) {
                try {
                    const inviter = await interaction.client.users.fetch(str(eventData.inviterId));
                    memberAddDetails.push(
                        `${t(locale, 'logSearchShared.member.inviterLabel')} ${inviter.tag} (${str(eventData.inviterId)})`,
                    );
                } catch {
                    memberAddDetails.push(
                        `${t(locale, 'logSearchShared.member.inviterIdLabel')} ${str(eventData.inviterId)}`,
                    );
                }
            }

            if (eventData.inviteCode) {
                memberAddDetails.push(
                    `${t(locale, 'logSearchShared.invite.codeLabel')} ${str(eventData.inviteCode)}`,
                );
            }

            eventSpecificsText =
                memberAddDetails.length > 0
                    ? memberAddDetails.join('\n')
                    : t(locale, 'logSearchShared.member.addNoInfo');

            try {
                const addedMemberUser = eventData.memberId
                    ? await interaction.client.users.fetch(str(eventData.memberId))
                    : null;
                if (addedMemberUser) {
                    nextThumbnailComponent = new ThumbnailBuilder({
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
            const memberRemoveDetails: string[] = [];
            if (eventData.memberTag) {
                memberRemoveDetails.push(
                    `${t(locale, 'logSearchShared.legacy.userLabel')} ${str(eventData.memberTag)} (${str(eventData.memberId, t(locale, 'logSearchShared.role.idMissing'))})`,
                );
            } else if (eventData.memberId) {
                memberRemoveDetails.push(
                    `${t(locale, 'logSearchShared.legacy.userIdLabel')} ${str(eventData.memberId)}`,
                );
            }

            if (eventData.reason) {
                memberRemoveDetails.push(
                    `${t(locale, 'logSearchShared.legacy.reasonLabel')} ${str(eventData.reason)}`,
                );
            }

            if (eventData.executorId) {
                try {
                    const executor = await interaction.client.users.fetch(
                        str(eventData.executorId),
                    );
                    memberRemoveDetails.push(
                        `${t(locale, 'logSearchShared.legacy.executorLabel')} ${executor.tag} (${str(eventData.executorId)})`,
                    );
                } catch {
                    memberRemoveDetails.push(
                        `${t(locale, 'logSearchShared.legacy.executorIdLabel')} ${str(eventData.executorId)}`,
                    );
                }
            }

            eventSpecificsText =
                memberRemoveDetails.length > 0
                    ? memberRemoveDetails.join('\n')
                    : t(locale, 'logSearchShared.member.removeNoInfo');

            try {
                const removedMemberUser = eventData.memberId
                    ? await interaction.client.users.fetch(str(eventData.memberId))
                    : null;
                if (removedMemberUser) {
                    nextThumbnailComponent = new ThumbnailBuilder({
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
            const memberUpdateDetails: string[] = [];
            const member = isJsonData(eventData.member) ? eventData.member : null;
            const user = isJsonData(eventData.user) ? eventData.user : null;
            const updatedMember: JsonData | null =
                member ??
                (log.user_id
                    ? {
                          id: log.user_id,
                          tag: str(user?.tag, `<@${log.user_id}>`),
                      }
                    : null);

            if (updatedMember) {
                memberUpdateDetails.push(
                    `${t(locale, 'logSearchShared.legacy.userLabel')} ${str(eventData.memberTag) || str(updatedMember.tag) || `<@${str(updatedMember.id)}>`} (${str(updatedMember.id)})`,
                );
            }

            const oldMember = isJsonData(eventData.oldMember) ? eventData.oldMember : undefined;
            const newMember = isJsonData(eventData.newMember) ? eventData.newMember : undefined;
            const oldRoleMap = getRoleMap(oldMember?.roles ?? eventData.oldRoles);
            const newRoleMap = getRoleMap(newMember?.roles ?? eventData.newRoles);

            const addedRoles: string[] = [];
            for (const [roleId, roleName] of newRoleMap) {
                if (!oldRoleMap.has(roleId)) {
                    const name =
                        roleName ??
                        interaction.guild?.roles.cache.get(roleId)?.name ??
                        t(locale, 'logSearchShared.member.unknownRole');
                    addedRoles.push(`${name} (<@&${roleId}>)`);
                }
            }

            const removedRoles: string[] = [];
            for (const [roleId, roleName] of oldRoleMap) {
                if (!newRoleMap.has(roleId)) {
                    const name =
                        roleName ??
                        interaction.guild?.roles.cache.get(roleId)?.name ??
                        t(locale, 'logSearchShared.member.unknownRole');
                    removedRoles.push(`${name} (<@&${roleId}>)`);
                }
            }

            if (addedRoles.length > 0) {
                memberUpdateDetails.push(
                    `${t(locale, 'logSearchShared.member.addedRolesLabel')} ${addedRoles.join(', ')}`,
                );
            }
            if (removedRoles.length > 0) {
                memberUpdateDetails.push(
                    `${t(locale, 'logSearchShared.member.removedRolesLabel')} ${removedRoles.join(', ')}`,
                );
            }

            if (
                eventData.oldNickname !== undefined &&
                eventData.newNickname !== undefined &&
                eventData.oldNickname !== eventData.newNickname
            ) {
                memberUpdateDetails.push(
                    `${t(locale, 'logSearchShared.member.nicknameChangedLabel')} \\\`${str(eventData.oldNickname, t(locale, 'logSearchShared.legacy.none'))}\\\` -> \\\`${str(eventData.newNickname, t(locale, 'logSearchShared.legacy.none'))}\\\``,
                );
            }
            if (eventData.oldAvatar !== eventData.newAvatar && eventData.newAvatar) {
                memberUpdateDetails.push(t(locale, 'logSearchShared.user.avatarChanged'));
            }
            if (
                eventData.oldCommunicationDisabledUntil !== eventData.newCommunicationDisabledUntil
            ) {
                const oldTimeout = eventData.oldCommunicationDisabledUntil
                    ? `<t:${Math.floor(new Date(str(eventData.oldCommunicationDisabledUntil)).getTime() / 1000)}:R>`
                    : t(locale, 'logSearchShared.legacy.none');
                const newTimeout = eventData.newCommunicationDisabledUntil
                    ? `<t:${Math.floor(new Date(str(eventData.newCommunicationDisabledUntil)).getTime() / 1000)}:R>`
                    : t(locale, 'logSearchShared.member.timeoutCleared');
                memberUpdateDetails.push(
                    `${t(locale, 'logSearchShared.member.timeoutChangedLabel')} ${oldTimeout} -> ${newTimeout}`,
                );
            }

            if (memberUpdateDetails.length === 1 && updatedMember) {
                eventSpecificsText =
                    memberUpdateDetails.join('\n') +
                    `\n${t(locale, 'logSearchShared.member.noDetailedChanges')}`;
            } else if (memberUpdateDetails.length > (updatedMember ? 1 : 0)) {
                eventSpecificsText = memberUpdateDetails.join('\n');
            } else {
                eventSpecificsText = t(locale, 'logSearchShared.member.updateNoInfo');
            }

            if (updatedMember?.id) {
                try {
                    const memberUser = await interaction.client.users.fetch(
                        log.user_id ?? str(updatedMember.id),
                    );
                    nextThumbnailComponent = new ThumbnailBuilder({
                        media: {
                            url: memberUser.displayAvatarURL({
                                forceStatic: false,
                                size: 64,
                            }),
                        },
                    });
                } catch {
                    /* Keep original or default thumbnail */
                }
            }

            break;
        }
        default:
            break;
    }

    return {
        eventSpecificsText,
        thumbnailComponent: nextThumbnailComponent,
    };
}

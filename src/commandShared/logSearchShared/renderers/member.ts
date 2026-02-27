import {
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';
import type { JsonData, JsonValue } from '../../../types/json.js';
import type { LogEntry } from '../../../types/logs.js';
import { str } from '../formatters.js';
import { isJsonData } from '../types.js';

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

export async function renderEvent({
    interaction,
    log,
    eventType,
    eventData,
    thumbnailComponent,
}: RenderMemberEventParams): Promise<RenderMemberEventResult> {
    let eventSpecificsText = '(내용 없음)';
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
                    `**사용자:** ${str(eventData.memberTag)} (${str(eventData.memberId, 'ID 없음')})`,
                );
            } else if (eventData.memberId) {
                memberAddDetails.push(`**사용자 ID:** ${str(eventData.memberId)}`);
            }

            if (eventData.inviterId) {
                try {
                    const inviter = await interaction.client.users.fetch(str(eventData.inviterId));
                    memberAddDetails.push(
                        `**초대자:** ${inviter.tag} (${str(eventData.inviterId)})`,
                    );
                } catch {
                    memberAddDetails.push(`**초대자 ID:** ${str(eventData.inviterId)}`);
                }
            }

            if (eventData.inviteCode) {
                memberAddDetails.push(`**초대 코드:** ${str(eventData.inviteCode)}`);
            }

            eventSpecificsText =
                memberAddDetails.length > 0 ? memberAddDetails.join('\n') : '멤버 참가 정보 없음';

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
                    `**사용자:** ${str(eventData.memberTag)} (${str(eventData.memberId, 'ID 없음')})`,
                );
            } else if (eventData.memberId) {
                memberRemoveDetails.push(`**사용자 ID:** ${str(eventData.memberId)}`);
            }

            if (eventData.reason) {
                memberRemoveDetails.push(`**사유:** ${str(eventData.reason)}`);
            }

            if (eventData.executorId) {
                try {
                    const executor = await interaction.client.users.fetch(
                        str(eventData.executorId),
                    );
                    memberRemoveDetails.push(
                        `**실행자:** ${executor.tag} (${str(eventData.executorId)})`,
                    );
                } catch {
                    memberRemoveDetails.push(`**실행자 ID:** ${str(eventData.executorId)}`);
                }
            }

            eventSpecificsText =
                memberRemoveDetails.length > 0
                    ? memberRemoveDetails.join('\n')
                    : '멤버 이탈 정보 없음';

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
                    `**사용자:** ${str(eventData.memberTag) || str(updatedMember.tag) || `<@${str(updatedMember.id)}>`} (${str(updatedMember.id)})`,
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
                        '알 수 없는 역할';
                    addedRoles.push(`${name} (<@&${roleId}>)`);
                }
            }

            const removedRoles: string[] = [];
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
                eventData.oldNickname !== undefined &&
                eventData.newNickname !== undefined &&
                eventData.oldNickname !== eventData.newNickname
            ) {
                memberUpdateDetails.push(
                    `**닉네임 변경:** \\\`${str(eventData.oldNickname, '(없음)')}\\\` -> \\\`${str(eventData.newNickname, '(없음)')}\\\``,
                );
            }
            if (eventData.oldAvatar !== eventData.newAvatar && eventData.newAvatar) {
                memberUpdateDetails.push(`**아바타 변경됨**`);
            }
            if (
                eventData.oldCommunicationDisabledUntil !== eventData.newCommunicationDisabledUntil
            ) {
                const oldTimeout = eventData.oldCommunicationDisabledUntil
                    ? `<t:${Math.floor(new Date(str(eventData.oldCommunicationDisabledUntil)).getTime() / 1000)}:R>`
                    : '없음';
                const newTimeout = eventData.newCommunicationDisabledUntil
                    ? `<t:${Math.floor(new Date(str(eventData.newCommunicationDisabledUntil)).getTime() / 1000)}:R>`
                    : '해제됨';
                memberUpdateDetails.push(`**타임아웃 변경:** ${oldTimeout} -> ${newTimeout}`);
            }

            if (memberUpdateDetails.length === 1 && updatedMember) {
                eventSpecificsText =
                    memberUpdateDetails.join('\n') +
                    '\n(세부 변경 사항 감지 안됨, 역할/닉네임 외 변경 가능성 있음)';
            } else if (memberUpdateDetails.length > (updatedMember ? 1 : 0)) {
                eventSpecificsText = memberUpdateDetails.join('\n');
            } else {
                eventSpecificsText = '멤버 업데이트 (세부 정보 분석 중 오류 또는 변경 사항 없음)';
            }

            if (updatedMember?.id) {
                try {
                    const memberUser = await interaction.client.users.fetch(
                        log.user_id ?? str(updatedMember.id),
                    );
                    if (memberUser) {
                        nextThumbnailComponent = new ThumbnailBuilder({
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
        default:
            break;
    }

    return {
        eventSpecificsText,
        thumbnailComponent: nextThumbnailComponent,
    };
}

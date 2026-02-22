import {
    PermissionsBitField,
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';
import type { JsonValue } from '../../../types/json.js';
import type { LogEntry } from '../../../types/logs.js';
import { num, str } from '../formatters.js';
import { isJsonData } from '../types.js';

interface RenderRoleEventParams {
    interaction: ChatInputCommandInteraction | MessageComponentInteraction;
    log: LogEntry;
    eventType: string;
    eventData: JsonValue | undefined;
    thumbnailComponent: ThumbnailBuilder;
}

interface RenderRoleEventResult {
    eventSpecificsText: string;
    thumbnailComponent: ThumbnailBuilder;
}

export async function renderEvent({
    interaction,
    log,
    eventType,
    eventData,
    thumbnailComponent,
}: RenderRoleEventParams): Promise<RenderRoleEventResult> {
    let eventSpecificsText = '(내용 없음)';
    let nextThumbnailComponent = thumbnailComponent;

    if (!isJsonData(eventData)) {
        return {
            eventSpecificsText,
            thumbnailComponent: nextThumbnailComponent,
        };
    }

    switch (eventType) {
        case 'guildRoleCreate': {
            const roleCreateDetails: string[] = [];
            const role = isJsonData(eventData.role) ? eventData.role : null;
            if (role) {
                roleCreateDetails.push(
                    `**역할 이름:** ${str(role.name, 'N/A')} (<@&${str(role.id, 'ID 없음')}>)`,
                );
                if (role.id) {
                    roleCreateDetails.push(`**역할 ID:** ${str(role.id)}`);
                }
                if (role.color) {
                    roleCreateDetails.push(
                        `**색상:** #${num(role.color).toString(16).padStart(6, '0')}`,
                    );
                }
                if (role.permissions) {
                    const permissions = new PermissionsBitField(BigInt(str(role.permissions, '0')));
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
                    const executorUser = await interaction.client.users.fetch(log.user_id);
                    if (executorUser) {
                        nextThumbnailComponent = new ThumbnailBuilder({
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
            const roleUpdateDetails: string[] = [];
            const oldRole = isJsonData(eventData.oldRole) ? eventData.oldRole : null;
            const newRole = isJsonData(eventData.newRole) ? eventData.newRole : null;

            if (newRole?.id) {
                roleUpdateDetails.push(
                    `**역할:** ${str(newRole.name) || str(oldRole?.name) || 'N/A'} (<@&${str(newRole.id)}>)`,
                );
                roleUpdateDetails.push(`**ID:** ${str(newRole.id)}`);
            } else if (oldRole?.id) {
                roleUpdateDetails.push(`**역할 ID:** ${str(oldRole.id, 'ID 없음')}`);
                if (oldRole.name) {
                    roleUpdateDetails.push(`**이전 역할 이름:** ${str(oldRole.name)}`);
                }
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

                const oldPerms = new PermissionsBitField(BigInt(str(oldRole.permissions, '0')));
                const newPerms = new PermissionsBitField(BigInt(str(newRole.permissions, '0')));
                if (oldPerms.bitfield !== newPerms.bitfield) {
                    const oldPermArray = oldPerms.toArray() as string[];
                    const newPermArray = newPerms.toArray() as string[];

                    const addedPerms = newPermArray.filter((p) => !oldPermArray.includes(p));
                    const removedPerms = oldPermArray.filter((p) => !newPermArray.includes(p));

                    if (addedPerms.length > 0) {
                        roleUpdateDetails.push(
                            `**추가된 권한 (${addedPerms.length}개):** ${addedPerms.slice(0, 3).join(', ')}${addedPerms.length > 3 ? ', ...' : ''}`,
                        );
                    }
                    if (removedPerms.length > 0) {
                        roleUpdateDetails.push(
                            `**제거된 권한 (${removedPerms.length}개):** ${removedPerms.slice(0, 3).join(', ')}${removedPerms.length > 3 ? ', ...' : ''}`,
                        );
                    }
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
                if (newRole.color) {
                    roleUpdateDetails.push(
                        `**색상:** #${num(newRole.color).toString(16).padStart(6, '0')}`,
                    );
                }
            } else if (oldRole) {
                roleUpdateDetails.push('(이전 역할 정보만 존재하여 변경 사항 비교 불가)');
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
                    const executorUser = await interaction.client.users.fetch(log.user_id);
                    if (executorUser) {
                        nextThumbnailComponent = new ThumbnailBuilder({
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
            const roleDeleteDetails: string[] = [];
            const role = isJsonData(eventData.role) ? eventData.role : null;
            if (role) {
                roleDeleteDetails.push(`**삭제된 역할 이름:** ${str(role.name, 'N/A')}`);
                if (role.id) {
                    roleDeleteDetails.push(`**삭제된 역할 ID:** ${str(role.id)}`);
                }
            }
            eventSpecificsText =
                roleDeleteDetails.length > 0
                    ? roleDeleteDetails.join('\n')
                    : '역할 삭제 정보 없음';

            if (log.user_id) {
                try {
                    const executorUser = await interaction.client.users.fetch(log.user_id);
                    if (executorUser) {
                        nextThumbnailComponent = new ThumbnailBuilder({
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
        default:
            break;
    }

    return {
        eventSpecificsText,
        thumbnailComponent: nextThumbnailComponent,
    };
}

import {
    PermissionsBitField,
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';
import type { JsonValue } from '../../../types/json.js';
import type { LogEntry } from '../../../types/logs.js';
import { getInteractionLocale, t } from '../../../i18n/index.js';
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

/**
 * 역할 관련 이벤트 데이터를 읽어 상세 텍스트와 썸네일을 구성합니다.
 */
export async function renderEvent({
    interaction,
    log,
    eventType,
    eventData,
    thumbnailComponent,
}: RenderRoleEventParams): Promise<RenderRoleEventResult> {
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
        case 'guildRoleCreate': {
            const roleCreateDetails: string[] = [];
            const role = isJsonData(eventData.role) ? eventData.role : null;
            if (role) {
                roleCreateDetails.push(
                    `${t(locale, 'logSearchShared.role.roleNameLabel')} ${str(role.name, 'N/A')} (<@&${str(role.id, t(locale, 'logSearchShared.role.idMissing'))}>)`,
                );
                if (role.id) {
                    roleCreateDetails.push(
                        `${t(locale, 'logSearchShared.role.roleIdLabel')} ${str(role.id)}`,
                    );
                }
                if (role.color) {
                    roleCreateDetails.push(
                        `**${t(locale, 'logSearchShared.role.colorLabel')}** #${num(role.color).toString(16).padStart(6, '0')}`,
                    );
                }
                if (role.permissions) {
                    const permissions = new PermissionsBitField(BigInt(str(role.permissions, '0')));
                    const permArray = permissions.toArray();
                    if (permArray.length > 0) {
                        roleCreateDetails.push(
                            t(locale, 'logSearchShared.role.permissionsWithCount', {
                                count: permArray.length,
                                value: `${permArray.slice(0, 3).join(', ')}${permArray.length > 3 ? ', ...' : ''}`,
                            }),
                        );
                    } else {
                        roleCreateDetails.push(
                            t(locale, 'logSearchShared.role.permissionsNone', {
                                none: t(locale, 'logSearchShared.legacy.none'),
                            }),
                        );
                    }
                }
            }
            eventSpecificsText =
                roleCreateDetails.length > 0
                    ? roleCreateDetails.join('\n')
                    : t(locale, 'logSearchShared.role.createNoInfo');

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
                    `${t(locale, 'logSearchShared.role.roleLabel')} ${str(newRole.name) || str(oldRole?.name) || 'N/A'} (<@&${str(newRole.id)}>)`,
                );
                roleUpdateDetails.push(`**ID:** ${str(newRole.id)}`);
            } else if (oldRole?.id) {
                roleUpdateDetails.push(
                    `${t(locale, 'logSearchShared.role.roleIdLabel')} ${str(oldRole.id, t(locale, 'logSearchShared.role.idMissing'))}`,
                );
                if (oldRole.name) {
                    roleUpdateDetails.push(
                        `${t(locale, 'logSearchShared.role.previousRoleNameLabel')} ${str(oldRole.name)}`,
                    );
                }
            }

            if (oldRole && newRole) {
                if (oldRole.name !== newRole.name) {
                    roleUpdateDetails.push(
                        `${t(locale, 'logSearchShared.legacy.nameChangedLabel')} \\\`${str(oldRole.name, t(locale, 'logSearchShared.legacy.none'))}\\\` -> \\\`${str(newRole.name, t(locale, 'logSearchShared.legacy.none'))}\\\``,
                    );
                }
                if (oldRole.color !== newRole.color) {
                    roleUpdateDetails.push(
                        `**${t(locale, 'logSearchShared.role.colorChangedLabel')}** \`#${num(oldRole.color).toString(16).padStart(6, '0')}\` -> \`#${num(newRole.color).toString(16).padStart(6, '0')}\``,
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
                            t(locale, 'logSearchShared.role.addedPermissions', {
                                count: addedPerms.length,
                                value: `${addedPerms.slice(0, 3).join(', ')}${addedPerms.length > 3 ? ', ...' : ''}`,
                            }),
                        );
                    }
                    if (removedPerms.length > 0) {
                        roleUpdateDetails.push(
                            t(locale, 'logSearchShared.role.removedPermissions', {
                                count: removedPerms.length,
                                value: `${removedPerms.slice(0, 3).join(', ')}${removedPerms.length > 3 ? ', ...' : ''}`,
                            }),
                        );
                    }
                }
                if (oldRole.hoist !== newRole.hoist) {
                    roleUpdateDetails.push(
                        `${t(locale, 'logSearchShared.role.hoistLabel')} ${oldRole.hoist ? t(locale, 'logSearchShared.legacy.active') : t(locale, 'logSearchShared.role.inactive')} -> ${newRole.hoist ? t(locale, 'logSearchShared.legacy.active') : t(locale, 'logSearchShared.role.inactive')}`,
                    );
                }
                if (oldRole.mentionable !== newRole.mentionable) {
                    roleUpdateDetails.push(
                        `${t(locale, 'logSearchShared.role.mentionableLabel')} ${oldRole.mentionable ? t(locale, 'logSearchShared.legacy.active') : t(locale, 'logSearchShared.role.inactive')} -> ${newRole.mentionable ? t(locale, 'logSearchShared.legacy.active') : t(locale, 'logSearchShared.role.inactive')}`,
                    );
                }
                if (oldRole.icon !== newRole.icon) {
                    roleUpdateDetails.push(t(locale, 'logSearchShared.role.iconChanged'));
                }
                if (oldRole.unicodeEmoji !== newRole.unicodeEmoji) {
                    roleUpdateDetails.push(
                        `${t(locale, 'logSearchShared.role.unicodeEmojiChangedLabel')} ${str(oldRole.unicodeEmoji, t(locale, 'logSearchShared.legacy.none'))} -> ${str(newRole.unicodeEmoji, t(locale, 'logSearchShared.legacy.none'))}`,
                    );
                }
            } else if (newRole) {
                roleUpdateDetails.push(t(locale, 'logSearchShared.role.onlyNewRole'));
                roleUpdateDetails.push(
                    `**${t(locale, 'logSearchShared.role.nameLabel')}** ${str(newRole.name, 'N/A')}`,
                );
                if (newRole.color) {
                    roleUpdateDetails.push(
                        `**${t(locale, 'logSearchShared.role.colorLabel')}** #${num(newRole.color).toString(16).padStart(6, '0')}`,
                    );
                }
            } else if (oldRole) {
                roleUpdateDetails.push(t(locale, 'logSearchShared.role.onlyOldRole'));
                roleUpdateDetails.push(
                    `**${t(locale, 'logSearchShared.role.nameLabel')}** ${str(oldRole.name, 'N/A')}`,
                );
            }

            eventSpecificsText =
                roleUpdateDetails.length > 2
                    ? roleUpdateDetails.join('\n')
                    : roleUpdateDetails.length > 0
                      ? roleUpdateDetails.join('\n') +
                        `\n${t(locale, 'logSearchShared.role.noDetailedChanges')}`
                      : t(locale, 'logSearchShared.role.updateNoInfo');

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
                roleDeleteDetails.push(
                    `${t(locale, 'logSearchShared.role.deletedRoleNameLabel')} ${str(role.name, 'N/A')}`,
                );
                if (role.id) {
                    roleDeleteDetails.push(
                        `${t(locale, 'logSearchShared.role.deletedRoleIdLabel')} ${str(role.id)}`,
                    );
                }
            }
            eventSpecificsText =
                roleDeleteDetails.length > 0
                    ? roleDeleteDetails.join('\n')
                    : t(locale, 'logSearchShared.role.deleteNoInfo');

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

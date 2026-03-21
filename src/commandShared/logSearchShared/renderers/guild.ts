import { ThumbnailBuilder } from 'discord.js';

import { getInteractionLocale, t } from '../deps.js';
import { num, str } from '../formatters.js';
import { isJsonData } from '../types.js';

import type { JsonData, GroupRendererInput, GroupRendererResult } from '../deps.js';

const buildUserThumbnail = async (
    input: GroupRendererInput,
    userId: string,
): Promise<ThumbnailBuilder | undefined> => {
    try {
        const user = await input.interaction.client.users.fetch(userId);
        return new ThumbnailBuilder({
            media: {
                url: user.displayAvatarURL({
                    forceStatic: false,
                    size: 64,
                }),
            },
        });
    } catch {
        return undefined;
    }
};

/**
 * guildBanAdd 로그의 상세 텍스트와 썸네일을 생성합니다.
 */
const renderGuildBanAdd = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const banDetails: string[] = [];
    const fallbackUserData: JsonData | null = input.eventData.userId
        ? { id: input.eventData.userId, tag: input.eventData.userTag }
        : null;
    const userData = isJsonData(input.eventData.user) ? input.eventData.user : fallbackUserData;
    const reasonValue = input.eventData.reason;
    const executorData = isJsonData(input.eventData.executor)
        ? input.eventData.executor
        : undefined;
    const executorId = str(executorData?.id);

    if (userData) {
        banDetails.push(
            `${t(locale, 'logSearchShared.legacy.userLabel')} ${str(userData.tag) || `<@${str(userData.id)}>`} (${str(userData.id)})`,
        );
    } else if (input.eventData.userId) {
        banDetails.push(
            `${t(locale, 'logSearchShared.legacy.userIdLabel')} ${str(input.eventData.userId)}`,
        );
    }

    if (reasonValue) {
        const reason = str(reasonValue);
        banDetails.push(
            `${t(locale, 'logSearchShared.legacy.reasonLabel')} ${reason.substring(0, 200)}${reason.length > 200 ? '...' : ''}`,
        );
    }

    if (executorData?.id) {
        banDetails.push(
            `${t(locale, 'logSearchShared.legacy.executorLabel')} ${str(executorData.tag) || `<@${str(executorData.id)}>`} (${str(executorData.id)})`,
        );
    } else if (input.logUserId && executorId !== input.logUserId) {
        try {
            const executorUser = await input.interaction.client.users.fetch(input.logUserId);
            banDetails.push(
                `${t(locale, 'logSearchShared.guild.executorLoggingLabel')} ${executorUser.tag} (<@${input.logUserId}>)`,
            );
        } catch {
            banDetails.push(
                `${t(locale, 'logSearchShared.guild.executorIdLoggingLabel')} ${str(input.logUserId)}`,
            );
        }
    }

    let thumbnailComponent: ThumbnailBuilder | undefined;
    const userIdForThumbnail = str(userData?.id);
    if (userIdForThumbnail) {
        thumbnailComponent = await buildUserThumbnail(input, userIdForThumbnail);
    } else if (executorId) {
        thumbnailComponent = await buildUserThumbnail(input, executorId);
    }

    return {
        eventSpecificsText:
            banDetails.length > 0
                ? banDetails.join('\n')
                : t(locale, 'logSearchShared.guild.banAddNoInfo'),
        thumbnailComponent,
    };
};

/**
 * guildBanRemove 로그의 상세 텍스트와 썸네일을 생성합니다.
 */
const renderGuildBanRemove = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const unbanDetails: string[] = [];
    const fallbackUserData: JsonData | null = input.eventData.userId
        ? { id: input.eventData.userId, tag: input.eventData.userTag }
        : null;
    const userData = isJsonData(input.eventData.user) ? input.eventData.user : fallbackUserData;
    const executorData = isJsonData(input.eventData.executor)
        ? input.eventData.executor
        : undefined;
    const executorId = str(executorData?.id);

    if (userData) {
        unbanDetails.push(
            `${t(locale, 'logSearchShared.legacy.userLabel')} ${str(userData.tag) || `<@${str(userData.id)}>`} (${str(userData.id)})`,
        );
    } else if (input.eventData.userId) {
        unbanDetails.push(
            `${t(locale, 'logSearchShared.legacy.userIdLabel')} ${str(input.eventData.userId)}`,
        );
    }

    if (executorData?.id) {
        unbanDetails.push(
            `${t(locale, 'logSearchShared.legacy.executorLabel')} ${str(executorData.tag) || `<@${str(executorData.id)}>`} (${str(executorData.id)})`,
        );
    } else if (input.logUserId && executorId !== input.logUserId) {
        try {
            const executorUser = await input.interaction.client.users.fetch(input.logUserId);
            unbanDetails.push(
                `${t(locale, 'logSearchShared.guild.executorLoggingLabel')} ${executorUser.tag} (<@${input.logUserId}>)`,
            );
        } catch {
            unbanDetails.push(
                `${t(locale, 'logSearchShared.guild.executorIdLoggingLabel')} ${str(input.logUserId)}`,
            );
        }
    }

    let thumbnailComponent: ThumbnailBuilder | undefined;
    const userIdForThumbnail = str(userData?.id);
    if (userIdForThumbnail) {
        thumbnailComponent = await buildUserThumbnail(input, userIdForThumbnail);
    } else if (executorId) {
        thumbnailComponent = await buildUserThumbnail(input, executorId);
    }

    return {
        eventSpecificsText:
            unbanDetails.length > 0
                ? unbanDetails.join('\n')
                : t(locale, 'logSearchShared.guild.banRemoveNoInfo'),
        thumbnailComponent,
    };
};

/**
 * guildUpdate 로그의 변경 요약 텍스트와 썸네일을 생성합니다.
 */
const renderGuildUpdate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const oldGuild = isJsonData(input.eventData.oldGuild) ? input.eventData.oldGuild : undefined;
    const newGuildCandidate = input.eventData.newGuild ?? input.eventData.guild;
    const newGuild = isJsonData(newGuildCandidate) ? newGuildCandidate : undefined;

    if (!oldGuild || !newGuild) {
        return {
            eventSpecificsText: t(locale, 'logSearchShared.guild.updateMissingState'),
        };
    }

    const guildChanges: string[] = [];
    guildChanges.push(
        t(locale, 'logSearchShared.guild.settingsChanged', {
            name: str(newGuild.name) || str(oldGuild.name),
        }),
    );

    if (oldGuild.name !== newGuild.name) {
        guildChanges.push(
            `${t(locale, 'logSearchShared.role.nameLabel')}: \\\`${str(oldGuild.name)}\\\` -> \\\`${str(newGuild.name)}\\\``,
        );
    }
    if (oldGuild.icon !== newGuild.icon) {
        guildChanges.push(t(locale, 'logSearchShared.guild.iconChanged'));
    }
    if (oldGuild.splash !== newGuild.splash) {
        guildChanges.push(t(locale, 'logSearchShared.guild.splashChanged'));
    }
    if (oldGuild.discoverySplash !== newGuild.discoverySplash) {
        guildChanges.push(t(locale, 'logSearchShared.guild.discoverySplashChanged'));
    }
    if (oldGuild.banner !== newGuild.banner) {
        guildChanges.push(t(locale, 'logSearchShared.guild.bannerChanged'));
    }
    if (oldGuild.ownerId !== newGuild.ownerId) {
        try {
            const oldOwnerId = str(oldGuild.ownerId);
            const newOwnerId = str(newGuild.ownerId);
            const oldOwnerUser = oldOwnerId
                ? await input.interaction.client.users.fetch(oldOwnerId)
                : null;
            const newOwnerUser = newOwnerId
                ? await input.interaction.client.users.fetch(newOwnerId)
                : null;
            guildChanges.push(
                `${t(locale, 'logSearchShared.guild.ownerLabel')} ${oldOwnerUser?.tag ?? oldOwnerId} -> ${newOwnerUser?.tag ?? newOwnerId}`,
            );
        } catch {
            guildChanges.push(
                `${t(locale, 'logSearchShared.guild.ownerIdLabel')} ${str(oldGuild.ownerId)} -> ${str(newGuild.ownerId)}`,
            );
        }
    }
    if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
        guildChanges.push(
            `${t(locale, 'logSearchShared.guild.afkChannelLabel')} ${oldGuild.afkChannelId ? `<#${str(oldGuild.afkChannelId)}>` : t(locale, 'logSearchShared.legacy.none')} -> ${newGuild.afkChannelId ? `<#${str(newGuild.afkChannelId)}>` : t(locale, 'logSearchShared.legacy.none')}`,
        );
    }
    if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
        guildChanges.push(
            `${t(locale, 'logSearchShared.guild.afkTimeoutLabel')} ${num(oldGuild.afkTimeout) / 60}${t(locale, 'logSearchShared.legacy.minuteShort')} -> ${num(newGuild.afkTimeout) / 60}${t(locale, 'logSearchShared.legacy.minuteShort')}`,
        );
    }
    if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
        guildChanges.push(
            `${t(locale, 'logSearchShared.guild.systemChannelLabel')} ${oldGuild.systemChannelId ? `<#${str(oldGuild.systemChannelId)}>` : t(locale, 'logSearchShared.legacy.none')} -> ${newGuild.systemChannelId ? `<#${str(newGuild.systemChannelId)}>` : t(locale, 'logSearchShared.legacy.none')}`,
        );
    }
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        guildChanges.push(
            t(locale, 'logSearchShared.guild.verificationLevelChanged', {
                oldLevel: str(oldGuild.verificationLevel),
                newLevel: str(newGuild.verificationLevel),
            }),
        );
    }
    if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
        guildChanges.push(
            t(locale, 'logSearchShared.guild.contentFilterChanged', {
                oldLevel: str(oldGuild.explicitContentFilter),
                newLevel: str(newGuild.explicitContentFilter),
            }),
        );
    }
    if (oldGuild.mfaLevel !== newGuild.mfaLevel) {
        guildChanges.push(
            t(locale, 'logSearchShared.guild.mfaLevelChanged', {
                oldLevel: str(oldGuild.mfaLevel),
                newLevel: str(newGuild.mfaLevel),
            }),
        );
    }
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
        guildChanges.push(
            `${t(locale, 'logSearchShared.guild.vanityUrlLabel')} \\\`${str(oldGuild.vanityURLCode, t(locale, 'logSearchShared.legacy.none'))}\\\` -> \\\`${str(newGuild.vanityURLCode, t(locale, 'logSearchShared.legacy.none'))}\\\``,
        );
    }
    if (oldGuild.description !== newGuild.description) {
        guildChanges.push(
            `${t(locale, 'logSearchShared.guild.descriptionChangedLabel')} \\\`${str(oldGuild.description, '').substring(0, 30)}...\\\` -> \\\`${str(newGuild.description, '').substring(0, 30)}...\\\``,
        );
    }
    if (oldGuild.preferredLocale !== newGuild.preferredLocale) {
        guildChanges.push(
            `${t(locale, 'logSearchShared.guild.preferredLocaleLabel')} ${str(oldGuild.preferredLocale)} -> ${str(newGuild.preferredLocale)}`,
        );
    }

    const eventSpecificsText =
        guildChanges.length > 1
            ? guildChanges.join('\n')
            : t(locale, 'logSearchShared.guild.settingsChangedNoDetails');

    let thumbnailComponent: ThumbnailBuilder | undefined;
    const guildIconUrl = input.interaction.guild?.iconURL({ forceStatic: false, size: 64 });
    if (guildIconUrl) {
        thumbnailComponent = new ThumbnailBuilder({
            media: {
                url: guildIconUrl,
            },
        });
    } else if (newGuild.icon) {
        thumbnailComponent = new ThumbnailBuilder({
            media: {
                url: `https://cdn.discordapp.com/icons/${str(newGuild.id)}/${str(newGuild.icon)}.png?size=64`,
            },
        });
    } else if (input.logUserId) {
        thumbnailComponent = await buildUserThumbnail(input, input.logUserId);
    }

    return {
        eventSpecificsText,
        thumbnailComponent,
    };
};

/**
 * 길드 이벤트 타입별 렌더러를 분기 호출합니다.
 */
export async function renderGuildEvent(input: GroupRendererInput): Promise<GroupRendererResult> {
    switch (input.eventType) {
        case 'guildBanAdd':
            return renderGuildBanAdd(input);
        case 'guildBanRemove':
            return renderGuildBanRemove(input);
        case 'guildUpdate':
            return renderGuildUpdate(input);
        default:
            return {
                eventSpecificsText: t(
                    getInteractionLocale(input.interaction),
                    'logSearchShared.legacy.noRecordedDetails',
                ),
            };
    }
}

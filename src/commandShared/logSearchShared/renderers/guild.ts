import { ThumbnailBuilder } from 'discord.js';
import { num, str } from '../formatters.js';
import { isJsonData } from '../types.js';
import type { JsonData } from '../../../types/json.js';
import type { GroupRendererInput, GroupRendererResult } from '../../../types/logSearchRenderers.js';

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

const renderGuildBanAdd = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
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
            `**사용자:** ${str(userData.tag) || `<@${str(userData.id)}>`} (${str(userData.id)})`,
        );
    } else if (input.eventData.userId) {
        banDetails.push(`**사용자 ID:** ${str(input.eventData.userId)}`);
    }

    if (reasonValue) {
        const reason = str(reasonValue);
        banDetails.push(`**사유:** ${reason.substring(0, 200)}${reason.length > 200 ? '...' : ''}`);
    }

    if (executorData?.id) {
        banDetails.push(
            `**실행자:** ${str(executorData.tag) || `<@${str(executorData.id)}>`} (${str(executorData.id)})`,
        );
    } else if (input.logUserId && executorId !== input.logUserId) {
        try {
            const executorUser = await input.interaction.client.users.fetch(input.logUserId);
            banDetails.push(`**실행자 (로깅):** ${executorUser.tag} (<@${input.logUserId}>)`);
        } catch {
            banDetails.push(`**실행자 ID (로깅):** ${str(input.logUserId)}`);
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
        eventSpecificsText: banDetails.length > 0 ? banDetails.join('\n') : '서버 차단 정보 없음',
        thumbnailComponent,
    };
};

const renderGuildBanRemove = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
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
            `**사용자:** ${str(userData.tag) || `<@${str(userData.id)}>`} (${str(userData.id)})`,
        );
    } else if (input.eventData.userId) {
        unbanDetails.push(`**사용자 ID:** ${str(input.eventData.userId)}`);
    }

    if (executorData?.id) {
        unbanDetails.push(
            `**실행자:** ${str(executorData.tag) || `<@${str(executorData.id)}>`} (${str(executorData.id)})`,
        );
    } else if (input.logUserId && executorId !== input.logUserId) {
        try {
            const executorUser = await input.interaction.client.users.fetch(input.logUserId);
            unbanDetails.push(`**실행자 (로깅):** ${executorUser.tag} (<@${input.logUserId}>)`);
        } catch {
            unbanDetails.push(`**실행자 ID (로깅):** ${str(input.logUserId)}`);
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
            unbanDetails.length > 0 ? unbanDetails.join('\n') : '서버 차단 해제 정보 없음',
        thumbnailComponent,
    };
};

const renderGuildUpdate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const oldGuild = isJsonData(input.eventData.oldGuild) ? input.eventData.oldGuild : undefined;
    const newGuildCandidate = input.eventData.newGuild ?? input.eventData.guild;
    const newGuild = isJsonData(newGuildCandidate) ? newGuildCandidate : undefined;

    if (!oldGuild || !newGuild) {
        return {
            eventSpecificsText: '길드 업데이트 정보 부족 (이전 또는 새 상태 누락)',
        };
    }

    const guildChanges: string[] = [];
    guildChanges.push(`**"${str(newGuild.name) || str(oldGuild.name)}" 설정 변경**`);

    if (oldGuild.name !== newGuild.name) {
        guildChanges.push(
            `**이름:** \\\`${str(oldGuild.name)}\\\` -> \\\`${str(newGuild.name)}\\\``,
        );
    }
    if (oldGuild.icon !== newGuild.icon) {
        guildChanges.push('**아이콘 변경됨**');
    }
    if (oldGuild.splash !== newGuild.splash) {
        guildChanges.push('**초대 배경 변경됨**');
    }
    if (oldGuild.discoverySplash !== newGuild.discoverySplash) {
        guildChanges.push('**탐색 스플래시 변경됨**');
    }
    if (oldGuild.banner !== newGuild.banner) {
        guildChanges.push('**배너 변경됨**');
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
                `**소유자:** ${oldOwnerUser?.tag ?? oldOwnerId} -> ${newOwnerUser?.tag ?? newOwnerId}`,
            );
        } catch {
            guildChanges.push(
                `**소유자 ID:** ${str(oldGuild.ownerId)} -> ${str(newGuild.ownerId)}`,
            );
        }
    }
    if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
        guildChanges.push(
            `**자리비움 채널:** ${oldGuild.afkChannelId ? `<#${str(oldGuild.afkChannelId)}>` : '없음'} -> ${newGuild.afkChannelId ? `<#${str(newGuild.afkChannelId)}>` : '없음'}`,
        );
    }
    if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
        guildChanges.push(
            `**자리비움 시간:** ${num(oldGuild.afkTimeout) / 60}분 -> ${num(newGuild.afkTimeout) / 60}분`,
        );
    }
    if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
        guildChanges.push(
            `**시스템 채널:** ${oldGuild.systemChannelId ? `<#${str(oldGuild.systemChannelId)}>` : '없음'} -> ${newGuild.systemChannelId ? `<#${str(newGuild.systemChannelId)}>` : '없음'}`,
        );
    }
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        guildChanges.push(
            `**인증 수준 변경됨** (L${str(oldGuild.verificationLevel)} -> L${str(newGuild.verificationLevel)})`,
        );
    }
    if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
        guildChanges.push(
            `**콘텐츠 필터 변경됨** (L${str(oldGuild.explicitContentFilter)} -> L${str(newGuild.explicitContentFilter)})`,
        );
    }
    if (oldGuild.mfaLevel !== newGuild.mfaLevel) {
        guildChanges.push(
            `**2FA 요구사항 변경됨** (L${str(oldGuild.mfaLevel)} -> L${str(newGuild.mfaLevel)})`,
        );
    }
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
        guildChanges.push(
            `** Vanity URL:** \\\`${str(oldGuild.vanityURLCode, '없음')}\\\` -> \\\`${str(newGuild.vanityURLCode, '없음')}\\\``,
        );
    }
    if (oldGuild.description !== newGuild.description) {
        guildChanges.push(
            `**설명 변경:** \\\`${str(oldGuild.description, '').substring(0, 30)}...\\\` -> \\\`${str(newGuild.description, '').substring(0, 30)}...\\\``,
        );
    }
    if (oldGuild.preferredLocale !== newGuild.preferredLocale) {
        guildChanges.push(
            `**기본 언어:** ${str(oldGuild.preferredLocale)} -> ${str(newGuild.preferredLocale)}`,
        );
    }

    const eventSpecificsText =
        guildChanges.length > 1 ? guildChanges.join('\n') : '서버 설정 변경됨 (세부사항 확인 필요)';

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

export async function renderGuildEvent(input: GroupRendererInput): Promise<GroupRendererResult> {
    switch (input.eventType) {
        case 'guildBanAdd':
            return renderGuildBanAdd(input);
        case 'guildBanRemove':
            return renderGuildBanRemove(input);
        case 'guildUpdate':
            return renderGuildUpdate(input);
        default:
            return { eventSpecificsText: '(기록된 세부 정보 없음)' };
    }
}

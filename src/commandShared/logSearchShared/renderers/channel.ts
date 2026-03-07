import { ChannelType, ThumbnailBuilder } from 'discord.js';

import { getInteractionLocale, t } from '../deps.js';
import { num, str } from '../formatters.js';
import { isJsonData } from '../types.js';

import type { GroupRendererInput, GroupRendererResult } from '../deps.js';

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
 * 현재 길드 아이콘을 썸네일 컴포넌트로 생성합니다.
 */
const buildGuildIconThumbnail = (input: GroupRendererInput): ThumbnailBuilder | undefined => {
    const guildIconUrl = input.interaction.guild?.iconURL({ forceStatic: false, size: 64 });
    if (!guildIconUrl) {
        return undefined;
    }

    return new ThumbnailBuilder({
        media: {
            url: guildIconUrl,
        },
    });
};

/**
 * channel payload에서 표준 채널 데이터 객체를 추출합니다.
 */
const getChannelData = (input: GroupRendererInput) =>
    isJsonData(input.eventData.channel)
        ? input.eventData.channel
        : isJsonData(input.eventData)
          ? input.eventData
          : undefined;

/**
 * channelCreate 로그의 상세 텍스트와 썸네일을 생성합니다.
 */
const renderChannelCreate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const details: string[] = [];
    const channel = getChannelData(input);
    if (!channel) {
        return {
            eventSpecificsText: t(locale, 'logSearchShared.channel.createNoInfo'),
            thumbnailComponent: input.logUserId
                ? await buildUserThumbnail(input, input.logUserId)
                : undefined,
        };
    }

    details.push(
        `${t(locale, 'logSearchShared.legacy.channelNameLabel')} ${str(channel.name, 'N/A')} (<#${str(channel.id, t(locale, 'logSearchShared.role.idMissing'))}>)`,
    );
    if (channel.id) {
        details.push(`**ID:** ${str(channel.id)}`);
    }
    const typeText =
        channel.type !== undefined
            ? (ChannelType[num(channel.type)] ??
              t(locale, 'logSearchShared.channel.unknownTypeNumber', {
                  type: str(channel.type),
              }))
            : t(locale, 'logSearchShared.legacy.unknown');
    details.push(`${t(locale, 'logSearchShared.legacy.typeLabel')} ${typeText}`);
    if (channel.parentId) {
        details.push(
            `${t(locale, 'logSearchShared.legacy.categoryLabel')} <#${str(channel.parentId)}>`,
        );
    }
    if (channel.topic) {
        details.push(
            `${t(locale, 'logSearchShared.legacy.topicLabel')} ${str(channel.topic).substring(0, 100)}${str(channel.topic).length > 100 ? '...' : ''}`,
        );
    }

    return {
        eventSpecificsText:
            details.length > 0
                ? details.join('\n')
                : t(locale, 'logSearchShared.channel.createNoInfo'),
        thumbnailComponent: input.logUserId
            ? await buildUserThumbnail(input, input.logUserId)
            : undefined,
    };
};

/**
 * channelDelete 로그의 상세 텍스트와 썸네일을 생성합니다.
 */
const renderChannelDelete = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const details: string[] = [];
    const channel = getChannelData(input);
    if (!channel) {
        const thumbnailFromExecutor = input.logUserId
            ? await buildUserThumbnail(input, input.logUserId)
            : undefined;
        const thumbnailComponent = thumbnailFromExecutor ?? buildGuildIconThumbnail(input);
        return {
            eventSpecificsText: t(locale, 'logSearchShared.channel.deleteNoInfo'),
            thumbnailComponent,
        };
    }

    details.push(
        `${t(locale, 'logSearchShared.legacy.deletedChannelNameLabel')} ${str(channel.name, 'N/A')}`,
    );
    if (channel.id) {
        details.push(`**ID:** ${str(channel.id)}`);
    }
    const typeText =
        channel.type !== undefined
            ? (ChannelType[num(channel.type)] ??
              t(locale, 'logSearchShared.channel.unknownTypeNumber', {
                  type: str(channel.type),
              }))
            : t(locale, 'logSearchShared.legacy.unknown');
    details.push(`${t(locale, 'logSearchShared.legacy.typeLabel')} ${typeText}`);

    const thumbnailFromExecutor = input.logUserId
        ? await buildUserThumbnail(input, input.logUserId)
        : undefined;
    const thumbnailComponent = thumbnailFromExecutor ?? buildGuildIconThumbnail(input);

    return {
        eventSpecificsText:
            details.length > 0
                ? details.join('\n')
                : t(locale, 'logSearchShared.channel.deleteNoInfo'),
        thumbnailComponent,
    };
};

/**
 * channelUpdate 로그의 변경 요약 텍스트와 썸네일을 생성합니다.
 */
const renderChannelUpdate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const details: string[] = [];
    const oldChannel = isJsonData(input.eventData.oldChannel)
        ? input.eventData.oldChannel
        : undefined;
    const newChannelCandidate = input.eventData.newChannel ?? input.eventData.channel;
    const newChannel = isJsonData(newChannelCandidate) ? newChannelCandidate : undefined;

    if (newChannel) {
        details.push(
            `${t(locale, 'logSearchShared.legacy.channelLabel')} ${str(newChannel.name, 'N/A')} (<#${str(newChannel.id, t(locale, 'logSearchShared.role.idMissing'))}>)`,
        );
        if (oldChannel) {
            if (oldChannel.name !== newChannel.name) {
                details.push(
                    `${t(locale, 'logSearchShared.legacy.nameChangedLabel')} \\\`${str(oldChannel.name)}\\\` -> \\\`${str(newChannel.name)}\\\``,
                );
            }
            if (oldChannel.topic !== newChannel.topic) {
                details.push(
                    `${t(locale, 'logSearchShared.legacy.topicChangedLabel')} \\\`${str(oldChannel.topic, '').substring(0, 30)}...\\\` -> \\\`${str(newChannel.topic, '').substring(0, 30)}...\\\``,
                );
            }
            if (oldChannel.parentId !== newChannel.parentId) {
                details.push(
                    `${t(locale, 'logSearchShared.legacy.categoryChangedLabel')} ${oldChannel.parentId ? `<#${str(oldChannel.parentId)}>` : t(locale, 'logSearchShared.legacy.none')} -> ${newChannel.parentId ? `<#${str(newChannel.parentId)}>` : t(locale, 'logSearchShared.legacy.none')}`,
                );
            }
            if (oldChannel.type !== newChannel.type) {
                details.push(
                    `${t(locale, 'logSearchShared.legacy.typeChangedLabel')} ${ChannelType[num(oldChannel.type)]} -> ${ChannelType[num(newChannel.type)]}`,
                );
            }
            if (oldChannel.nsfw !== newChannel.nsfw) {
                details.push(
                    `${t(locale, 'logSearchShared.channel.nsfwLabel')} ${oldChannel.nsfw ? t(locale, 'logSearchShared.legacy.yes') : t(locale, 'logSearchShared.legacy.no')} -> ${newChannel.nsfw ? t(locale, 'logSearchShared.legacy.yes') : t(locale, 'logSearchShared.legacy.no')}`,
                );
            }
            if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
                details.push(
                    `${t(locale, 'logSearchShared.channel.slowmodeLabel')} ${num(oldChannel.rateLimitPerUser)}${t(locale, 'logSearchShared.legacy.secondShort')} -> ${num(newChannel.rateLimitPerUser)}${t(locale, 'logSearchShared.legacy.secondShort')}`,
                );
            }
        } else {
            details.push(t(locale, 'logSearchShared.channel.noPrevious'));
        }
    } else {
        details.push(t(locale, 'logSearchShared.channel.noInfo'));
    }

    return {
        eventSpecificsText:
            details.length > 0
                ? details.join('\n')
                : t(locale, 'logSearchShared.channel.updateNoInfo'),
        thumbnailComponent: input.logUserId
            ? await buildUserThumbnail(input, input.logUserId)
            : undefined,
    };
};

/**
 * channelPinsUpdate 로그의 상세 텍스트와 썸네일을 생성합니다.
 */
const renderChannelPinsUpdate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const details: string[] = [];
    const channel = isJsonData(input.eventData.channel) ? input.eventData.channel : undefined;
    const channelId = str(input.eventData.channelId ?? channel?.id);
    const lastPinTimestamp = str(input.eventData.lastPinTimestamp ?? input.eventData.timestamp);

    if (channelId) {
        details.push(`${t(locale, 'logSearchShared.legacy.channelLabel')} <#${channelId}>`);
    }
    if (lastPinTimestamp) {
        details.push(
            `${t(locale, 'logSearchShared.channel.lastPinLabel')} <t:${Math.floor(new Date(lastPinTimestamp).getTime() / 1000)}:F>`,
        );
    } else {
        details.push(t(locale, 'logSearchShared.channel.pinsUpdated'));
    }

    return {
        eventSpecificsText: details.join('\n'),
        thumbnailComponent: input.logUserId
            ? await buildUserThumbnail(input, input.logUserId)
            : undefined,
    };
};

/**
 * 채널 이벤트 타입별 렌더러를 분기 호출합니다.
 */
export async function renderChannelEvent(input: GroupRendererInput): Promise<GroupRendererResult> {
    switch (input.eventType) {
        case 'channelCreate':
            return renderChannelCreate(input);
        case 'channelDelete':
            return renderChannelDelete(input);
        case 'channelUpdate':
            return renderChannelUpdate(input);
        case 'channelPinsUpdate':
            return renderChannelPinsUpdate(input);
        default:
            return {
                eventSpecificsText: t(
                    getInteractionLocale(input.interaction),
                    'logSearchShared.legacy.noRecordedDetails',
                ),
            };
    }
}

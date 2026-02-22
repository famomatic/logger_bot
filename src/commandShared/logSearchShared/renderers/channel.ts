import { ChannelType, ThumbnailBuilder } from 'discord.js';
import { num, str } from '../formatters.js';
import { isJsonData } from '../types.js';
import type { GroupRendererInput, GroupRendererResult } from './types.js';

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

const getChannelData = (input: GroupRendererInput) =>
    isJsonData(input.eventData.channel) ? input.eventData.channel : input.eventData;

const renderChannelCreate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const details: string[] = [];
    const channel = getChannelData(input);

    if (channel) {
        details.push(
            `**채널 이름:** ${str(channel.name, 'N/A')} (<#${str(channel.id, 'ID 없음')}>)`,
        );
        if (channel.id) {
            details.push(`**ID:** ${str(channel.id)}`);
        }
        const typeText =
            channel.type !== undefined
                ? (ChannelType[num(channel.type)] ?? `타입 ${str(channel.type)}`)
                : '알 수 없음';
        details.push(`**타입:** ${typeText}`);
        if (channel.parentId) {
            details.push(`**카테고리:** <#${str(channel.parentId)}>`);
        }
        if (channel.topic) {
            details.push(
                `**주제:** ${str(channel.topic).substring(0, 100)}${str(channel.topic).length > 100 ? '...' : ''}`,
            );
        }
    }

    return {
        eventSpecificsText: details.length > 0 ? details.join('\n') : '채널 생성 정보 없음',
        thumbnailComponent: input.logUserId
            ? await buildUserThumbnail(input, input.logUserId)
            : undefined,
    };
};

const renderChannelDelete = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const details: string[] = [];
    const channel = getChannelData(input);

    if (channel) {
        details.push(`**삭제된 채널 이름:** ${str(channel.name, 'N/A')}`);
        if (channel.id) {
            details.push(`**ID:** ${str(channel.id)}`);
        }
        const typeText =
            channel.type !== undefined
                ? (ChannelType[num(channel.type)] ?? `타입 ${str(channel.type)}`)
                : '알 수 없음';
        details.push(`**타입:** ${typeText}`);
    }

    const thumbnailFromExecutor = input.logUserId
        ? await buildUserThumbnail(input, input.logUserId)
        : undefined;
    const thumbnailComponent = thumbnailFromExecutor ?? buildGuildIconThumbnail(input);

    return {
        eventSpecificsText: details.length > 0 ? details.join('\n') : '채널 삭제 정보 없음',
        thumbnailComponent,
    };
};

const renderChannelUpdate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const details: string[] = [];
    const oldChannel = isJsonData(input.eventData.oldChannel)
        ? input.eventData.oldChannel
        : undefined;
    const newChannelCandidate = input.eventData.newChannel ?? input.eventData.channel;
    const newChannel = isJsonData(newChannelCandidate) ? newChannelCandidate : undefined;

    if (newChannel) {
        details.push(
            `**채널:** ${str(newChannel.name, 'N/A')} (<#${str(newChannel.id, 'ID 없음')}>)`,
        );
        if (oldChannel) {
            if (oldChannel.name !== newChannel.name) {
                details.push(
                    `**이름 변경:** \\\`${str(oldChannel.name)}\\\` -> \\\`${str(newChannel.name)}\\\``,
                );
            }
            if (oldChannel.topic !== newChannel.topic) {
                details.push(
                    `**주제 변경:** \\\`${str(oldChannel.topic, '').substring(0, 30)}...\\\` -> \\\`${str(newChannel.topic, '').substring(0, 30)}...\\\``,
                );
            }
            if (oldChannel.parentId !== newChannel.parentId) {
                details.push(
                    `**카테고리 변경:** ${oldChannel.parentId ? `<#${str(oldChannel.parentId)}>` : '없음'} -> ${newChannel.parentId ? `<#${str(newChannel.parentId)}>` : '없음'}`,
                );
            }
            if (oldChannel.type !== newChannel.type) {
                details.push(
                    `**타입 변경:** ${ChannelType[num(oldChannel.type)]} -> ${ChannelType[num(newChannel.type)]}`,
                );
            }
            if (oldChannel.nsfw !== newChannel.nsfw) {
                details.push(
                    `**NSFW:** ${oldChannel.nsfw ? '예' : '아니오'} -> ${newChannel.nsfw ? '예' : '아니오'}`,
                );
            }
            if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
                details.push(
                    `**슬로우 모드:** ${num(oldChannel.rateLimitPerUser)}초 -> ${num(newChannel.rateLimitPerUser)}초`,
                );
            }
        } else {
            details.push('(이전 채널 정보 없음)');
        }
    } else {
        details.push('채널 정보 없음');
    }

    return {
        eventSpecificsText: details.length > 0 ? details.join('\n') : '채널 업데이트 정보 없음',
        thumbnailComponent: input.logUserId
            ? await buildUserThumbnail(input, input.logUserId)
            : undefined,
    };
};

const renderChannelPinsUpdate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const details: string[] = [];
    const channel = isJsonData(input.eventData.channel) ? input.eventData.channel : undefined;
    const channelId = str(input.eventData.channelId ?? channel?.id);
    const lastPinTimestamp = str(input.eventData.lastPinTimestamp ?? input.eventData.timestamp);

    if (channelId) {
        details.push(`**채널:** <#${channelId}>`);
    }
    if (lastPinTimestamp) {
        details.push(
            `**마지막 고정 시간:** <t:${Math.floor(new Date(lastPinTimestamp).getTime() / 1000)}:F>`,
        );
    } else {
        details.push('채널 고정핀 업데이트됨');
    }

    return {
        eventSpecificsText: details.join('\n'),
        thumbnailComponent: input.logUserId
            ? await buildUserThumbnail(input, input.logUserId)
            : undefined,
    };
};

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
            return { eventSpecificsText: '(기록된 세부 정보 없음)' };
    }
}

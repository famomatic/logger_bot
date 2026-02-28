import { ThumbnailBuilder } from 'discord.js';
import { num, str } from '../formatters.js';
import { isJsonData } from '../types.js';
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

const EVENT_TYPES: Record<number, string> = {
    1: '스테이지',
    2: '음성 채널',
    3: '외부 링크',
};

const EVENT_STATUSES: Record<number, string> = {
    1: '예정',
    2: '활성',
    3: '완료됨',
    4: '취소됨',
};

const renderScheduledEventCreate = async (
    input: GroupRendererInput,
): Promise<GroupRendererResult> => {
    const eventDetails: string[] = [];
    const event = isJsonData(input.eventData.scheduledEvent)
        ? input.eventData.scheduledEvent
        : input.eventData;

    if (event) {
        eventDetails.push(`**이벤트 이름:** ${str(event.name, 'N/A')}`);
        if (event.id) {
            eventDetails.push(`**ID:** ${str(event.id)}`);
        }
        if (event.description) {
            eventDetails.push(
                `**설명:** ${str(event.description).substring(0, 100)}${str(event.description).length > 100 ? '...' : ''}`,
            );
        }
        if (event.scheduledStartTime) {
            eventDetails.push(
                `**시작 시간:** <t:${Math.floor(new Date(str(event.scheduledStartTime)).getTime() / 1000)}:F>`,
            );
        }
        if (event.scheduledEndTime) {
            eventDetails.push(
                `**종료 시간:** <t:${Math.floor(new Date(str(event.scheduledEndTime)).getTime() / 1000)}:F>`,
            );
        }
        if (event.entityType !== undefined) {
            eventDetails.push(
                `**유형:** ${EVENT_TYPES[num(event.entityType)] ?? `알 수 없음 (${str(event.entityType)})`}`,
            );
        }
        if (event.channelId) {
            eventDetails.push(`**채널:** <#${str(event.channelId)}>`);
        } else if (isJsonData(event.entityMetadata) && event.entityMetadata.location) {
            eventDetails.push(`**위치:** ${str(event.entityMetadata.location)}`);
        }

        const creatorId = str(event.creatorId);
        if (creatorId) {
            try {
                const creator = await input.interaction.client.users.fetch(creatorId);
                eventDetails.push(`**생성자:** ${creator.tag} (<@${creatorId}>)`);
            } catch {
                eventDetails.push(`**생성자 ID:** ${creatorId}`);
            }
        }
    }

    let thumbnailComponent: ThumbnailBuilder | undefined;
    const eventId = str(event.id);
    const eventImage = str(event.image);
    const creatorId = str(event.creatorId);
    if (eventId && eventImage) {
        thumbnailComponent = new ThumbnailBuilder({
            media: {
                url: `https://cdn.discordapp.com/guild-events/${eventId}/${eventImage}.png?size=64`,
            },
        });
    } else if (creatorId) {
        thumbnailComponent = await buildUserThumbnail(input, creatorId);
    }

    return {
        eventSpecificsText:
            eventDetails.length > 0 ? eventDetails.join('\n') : '예약된 이벤트 생성 정보 없음',
        thumbnailComponent,
    };
};

const renderScheduledEventUpdate = async (
    input: GroupRendererInput,
): Promise<GroupRendererResult> => {
    const eventDetails: string[] = [];
    const oldEvent = isJsonData(input.eventData.oldScheduledEvent)
        ? input.eventData.oldScheduledEvent
        : undefined;
    const newEventCandidate = input.eventData.newScheduledEvent ?? input.eventData.scheduledEvent;
    const newEvent = isJsonData(newEventCandidate) ? newEventCandidate : undefined;

    if (newEvent) {
        eventDetails.push(
            `**이벤트:** ${str(newEvent.name, 'N/A')} (ID: ${str(newEvent.id, '정보 없음')})`,
        );
        if (oldEvent) {
            if (oldEvent.name !== newEvent.name) {
                eventDetails.push(
                    `**이름 변경:** \\\`${str(oldEvent.name)}\\\` -> \\\`${str(newEvent.name)}\\\``,
                );
            }
            if (oldEvent.description !== newEvent.description) {
                eventDetails.push(
                    `**설명 변경:** \\\`${str(oldEvent.description, '').substring(0, 30)}...\\\` -> \\\`${str(newEvent.description, '').substring(0, 30)}...\\\``,
                );
            }
            if (
                new Date(str(oldEvent.scheduledStartTime)).getTime() !==
                new Date(str(newEvent.scheduledStartTime)).getTime()
            ) {
                eventDetails.push(
                    `**시작 시간 변경:** <t:${Math.floor(new Date(str(oldEvent.scheduledStartTime)).getTime() / 1000)}:R> -> <t:${Math.floor(new Date(str(newEvent.scheduledStartTime)).getTime() / 1000)}:R>`,
                );
            }
            if (oldEvent.status !== newEvent.status) {
                eventDetails.push(
                    `**상태 변경:** ${EVENT_STATUSES[num(oldEvent.status)] ?? `상태 ${str(oldEvent.status)}`} -> ${EVENT_STATUSES[num(newEvent.status)] ?? `상태 ${str(newEvent.status)}`}`,
                );
            }
            if (oldEvent.entityType !== newEvent.entityType) {
                eventDetails.push(
                    `**유형 변경:** ${EVENT_TYPES[num(oldEvent.entityType)] ?? `타입 ${str(oldEvent.entityType)}`} -> ${EVENT_TYPES[num(newEvent.entityType)] ?? `타입 ${str(newEvent.entityType)}`}`,
                );
            }
        } else {
            eventDetails.push('(이전 이벤트 정보 없음)');
        }
    } else {
        eventDetails.push('예약된 이벤트 정보 없음');
    }

    let thumbnailComponent: ThumbnailBuilder | undefined;
    const eventId = str(newEvent?.id);
    const eventImage = str(newEvent?.image);
    const creatorId = str(newEvent?.creatorId);
    if (eventId && eventImage) {
        thumbnailComponent = new ThumbnailBuilder({
            media: {
                url: `https://cdn.discordapp.com/guild-events/${eventId}/${eventImage}.png?size=64`,
            },
        });
    } else if (creatorId) {
        thumbnailComponent = await buildUserThumbnail(input, creatorId);
    } else if (input.logUserId) {
        thumbnailComponent = await buildUserThumbnail(input, input.logUserId);
    }

    return {
        eventSpecificsText:
            eventDetails.length > 0 ? eventDetails.join('\n') : '예약된 이벤트 업데이트 정보 없음',
        thumbnailComponent,
    };
};

const renderScheduledEventDelete = async (
    input: GroupRendererInput,
): Promise<GroupRendererResult> => {
    const eventDetails: string[] = [];
    const event = isJsonData(input.eventData.scheduledEvent)
        ? input.eventData.scheduledEvent
        : input.eventData;

    if (event) {
        eventDetails.push(`**삭제된 이벤트 이름:** ${str(event.name, 'N/A')}`);
        if (event.id) {
            eventDetails.push(`**ID:** ${str(event.id)}`);
        }
        const creatorId = str(event.creatorId);
        if (creatorId) {
            try {
                const creator = await input.interaction.client.users.fetch(creatorId);
                eventDetails.push(`**생성자:** ${creator.tag} (<@${creatorId}>)`);
            } catch {
                eventDetails.push(`**생성자 ID:** ${creatorId}`);
            }
        }
    }

    let thumbnailComponent: ThumbnailBuilder | undefined;
    if (input.logUserId) {
        thumbnailComponent = await buildUserThumbnail(input, input.logUserId);
    }

    return {
        eventSpecificsText:
            eventDetails.length > 0 ? eventDetails.join('\n') : '예약된 이벤트 삭제 정보 없음',
        thumbnailComponent,
    };
};

const renderScheduledEventUserChange = async (
    input: GroupRendererInput,
    userLabel: '참가 사용자' | '이탈 사용자',
    emptyMessage: string,
): Promise<GroupRendererResult> => {
    const details: string[] = [];
    const eventId = str(input.eventData.scheduledEventId ?? input.eventData.eventId);
    const userId = str(input.eventData.userId);
    const eventName = str(input.eventData.eventName);

    if (eventName) {
        details.push(`**이벤트:** ${eventName}`);
    } else if (eventId) {
        details.push(`**이벤트 ID:** ${eventId}`);
    }

    if (userId) {
        details.push(`**${userLabel}:** <@${userId}> (${userId})`);
    }

    const guild = input.interaction.guild;
    if (eventId && !eventName && guild) {
        try {
            const guildEvent = await guild.scheduledEvents.fetch(eventId);
            if (guildEvent.name) {
                details.unshift(`**이벤트:** ${guildEvent.name}`);
            } else if (guildEvent.id) {
                details.unshift(`**이벤트 ID (이름 조회 불가):** ${guildEvent.id}`);
            }
        } catch {
            /* empty */
        }
    }

    let thumbnailComponent: ThumbnailBuilder | undefined;
    if (userId) {
        thumbnailComponent = await buildUserThumbnail(input, userId);
    } else {
        const guildScheduledEvent = isJsonData(input.eventData.guildScheduledEvent)
            ? input.eventData.guildScheduledEvent
            : undefined;
        const scheduledEventId = str(guildScheduledEvent?.id);
        const scheduledEventImage = str(guildScheduledEvent?.image);
        if (scheduledEventId && scheduledEventImage) {
            thumbnailComponent = new ThumbnailBuilder({
                media: {
                    url: `https://cdn.discordapp.com/guild-events/${scheduledEventId}/${scheduledEventImage}.png?size=64`,
                },
            });
        }
    }

    return {
        eventSpecificsText: details.length > 0 ? details.join('\n') : emptyMessage,
        thumbnailComponent,
    };
};

export async function renderScheduledEvent(
    input: GroupRendererInput,
): Promise<GroupRendererResult> {
    switch (input.eventType) {
        case 'guildScheduledEventCreate':
            return renderScheduledEventCreate(input);
        case 'guildScheduledEventUpdate':
            return renderScheduledEventUpdate(input);
        case 'guildScheduledEventDelete':
            return renderScheduledEventDelete(input);
        case 'guildScheduledEventUserAdd':
            return renderScheduledEventUserChange(
                input,
                '참가 사용자',
                '예약된 이벤트 사용자 추가 정보 없음',
            );
        case 'guildScheduledEventUserRemove':
            return renderScheduledEventUserChange(
                input,
                '이탈 사용자',
                '예약된 이벤트 사용자 제거 정보 없음',
            );
        default:
            return { eventSpecificsText: '(기록된 세부 정보 없음)' };
    }
}

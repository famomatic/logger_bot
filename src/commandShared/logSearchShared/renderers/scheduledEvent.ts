import { ThumbnailBuilder } from 'discord.js';

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

const EVENT_TYPES: Record<number, string> = { 1: 'stage', 2: 'voice', 3: 'external' };
const EVENT_STATUSES: Record<number, string> = {
    1: 'scheduled',
    2: 'active',
    3: 'completed',
    4: 'canceled',
};

const renderScheduledEventCreate = async (
    input: GroupRendererInput,
): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const eventDetails: string[] = [];
    const event = isJsonData(input.eventData.scheduledEvent)
        ? input.eventData.scheduledEvent
        : isJsonData(input.eventData)
          ? input.eventData
          : undefined;

    if (event) {
        eventDetails.push(
            `${t(locale, 'logSearchShared.scheduledEvent.eventNameLabel')} ${str(event.name, 'N/A')}`,
        );
        if (event.id) {
            eventDetails.push(`**ID:** ${str(event.id)}`);
        }
        if (event.description) {
            eventDetails.push(
                `${t(locale, 'logSearchShared.legacy.descriptionLabel')} ${str(event.description).substring(0, 100)}${str(event.description).length > 100 ? '...' : ''}`,
            );
        }
        if (event.scheduledStartTime) {
            eventDetails.push(
                `${t(locale, 'logSearchShared.scheduledEvent.startTimeLabel')} <t:${Math.floor(new Date(str(event.scheduledStartTime)).getTime() / 1000)}:F>`,
            );
        }
        if (event.scheduledEndTime) {
            eventDetails.push(
                `${t(locale, 'logSearchShared.scheduledEvent.endTimeLabel')} <t:${Math.floor(new Date(str(event.scheduledEndTime)).getTime() / 1000)}:F>`,
            );
        }
        if (event.entityType !== undefined) {
            eventDetails.push(
                `${t(locale, 'logSearchShared.legacy.typeLabel')} ${t(locale, `logSearchShared.scheduledEvent.type.${EVENT_TYPES[num(event.entityType)] ?? 'unknown'}`)}${EVENT_TYPES[num(event.entityType)] ? '' : ` (${str(event.entityType)})`}`,
            );
        }
        if (event.channelId) {
            eventDetails.push(
                `${t(locale, 'logSearchShared.legacy.channelLabel')} <#${str(event.channelId)}>`,
            );
        } else if (isJsonData(event.entityMetadata) && event.entityMetadata.location) {
            eventDetails.push(
                `${t(locale, 'logSearchShared.scheduledEvent.locationLabel')} ${str(event.entityMetadata.location)}`,
            );
        }

        const creatorId = str(event.creatorId);
        if (creatorId) {
            try {
                const creator = await input.interaction.client.users.fetch(creatorId);
                eventDetails.push(
                    `${t(locale, 'logSearchShared.legacy.creatorLabel')} ${creator.tag} (<@${creatorId}>)`,
                );
            } catch {
                eventDetails.push(
                    `${t(locale, 'logSearchShared.legacy.creatorIdLabel')} ${creatorId}`,
                );
            }
        }
    }

    let thumbnailComponent: ThumbnailBuilder | undefined;
    const eventId = str(event?.id);
    const eventImage = str(event?.image);
    const creatorId = str(event?.creatorId);
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
            eventDetails.length > 0
                ? eventDetails.join('\n')
                : t(locale, 'logSearchShared.scheduledEvent.createNoInfo'),
        thumbnailComponent,
    };
};

const renderScheduledEventUpdate = async (
    input: GroupRendererInput,
): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const eventDetails: string[] = [];
    const oldEvent = isJsonData(input.eventData.oldScheduledEvent)
        ? input.eventData.oldScheduledEvent
        : undefined;
    const newEventCandidate = input.eventData.newScheduledEvent ?? input.eventData.scheduledEvent;
    const newEvent = isJsonData(newEventCandidate) ? newEventCandidate : undefined;

    if (newEvent) {
        eventDetails.push(
            `${t(locale, 'logSearchShared.legacy.eventLabel')} ${str(newEvent.name, 'N/A')} (ID: ${str(newEvent.id, t(locale, 'logSearchShared.legacy.noInfo'))})`,
        );
        if (oldEvent) {
            if (oldEvent.name !== newEvent.name) {
                eventDetails.push(
                    `${t(locale, 'logSearchShared.legacy.nameChangedLabel')} \\\`${str(oldEvent.name)}\\\` -> \\\`${str(newEvent.name)}\\\``,
                );
            }
            if (oldEvent.description !== newEvent.description) {
                eventDetails.push(
                    `${t(locale, 'logSearchShared.guild.descriptionChangedLabel')} \\\`${str(oldEvent.description, '').substring(0, 30)}...\\\` -> \\\`${str(newEvent.description, '').substring(0, 30)}...\\\``,
                );
            }
            if (
                new Date(str(oldEvent.scheduledStartTime)).getTime() !==
                new Date(str(newEvent.scheduledStartTime)).getTime()
            ) {
                eventDetails.push(
                    `${t(locale, 'logSearchShared.scheduledEvent.startTimeChangedLabel')} <t:${Math.floor(new Date(str(oldEvent.scheduledStartTime)).getTime() / 1000)}:R> -> <t:${Math.floor(new Date(str(newEvent.scheduledStartTime)).getTime() / 1000)}:R>`,
                );
            }
            if (oldEvent.status !== newEvent.status) {
                eventDetails.push(
                    `${t(locale, 'logSearchShared.scheduledEvent.statusChangedLabel')} ${t(locale, `logSearchShared.scheduledEvent.status.${EVENT_STATUSES[num(oldEvent.status)] ?? 'unknown'}`)} -> ${t(locale, `logSearchShared.scheduledEvent.status.${EVENT_STATUSES[num(newEvent.status)] ?? 'unknown'}`)}`,
                );
            }
            if (oldEvent.entityType !== newEvent.entityType) {
                eventDetails.push(
                    `${t(locale, 'logSearchShared.legacy.typeChangedLabel')} ${t(locale, `logSearchShared.scheduledEvent.type.${EVENT_TYPES[num(oldEvent.entityType)] ?? 'unknown'}`)} -> ${t(locale, `logSearchShared.scheduledEvent.type.${EVENT_TYPES[num(newEvent.entityType)] ?? 'unknown'}`)}`,
                );
            }
        } else {
            eventDetails.push(t(locale, 'logSearchShared.scheduledEvent.noPrevious'));
        }
    } else {
        eventDetails.push(t(locale, 'logSearchShared.scheduledEvent.noInfo'));
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
            eventDetails.length > 0
                ? eventDetails.join('\n')
                : t(locale, 'logSearchShared.scheduledEvent.updateNoInfo'),
        thumbnailComponent,
    };
};

const renderScheduledEventDelete = async (
    input: GroupRendererInput,
): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const eventDetails: string[] = [];
    const event = isJsonData(input.eventData.scheduledEvent)
        ? input.eventData.scheduledEvent
        : isJsonData(input.eventData)
          ? input.eventData
          : undefined;

    if (event) {
        eventDetails.push(
            `${t(locale, 'logSearchShared.scheduledEvent.deletedEventNameLabel')} ${str(event.name, 'N/A')}`,
        );
        if (event.id) {
            eventDetails.push(`**ID:** ${str(event.id)}`);
        }
        const creatorId = str(event.creatorId);
        if (creatorId) {
            try {
                const creator = await input.interaction.client.users.fetch(creatorId);
                eventDetails.push(
                    `${t(locale, 'logSearchShared.legacy.creatorLabel')} ${creator.tag} (<@${creatorId}>)`,
                );
            } catch {
                eventDetails.push(
                    `${t(locale, 'logSearchShared.legacy.creatorIdLabel')} ${creatorId}`,
                );
            }
        }
    }

    let thumbnailComponent: ThumbnailBuilder | undefined;
    if (input.logUserId) {
        thumbnailComponent = await buildUserThumbnail(input, input.logUserId);
    }

    return {
        eventSpecificsText:
            eventDetails.length > 0
                ? eventDetails.join('\n')
                : t(locale, 'logSearchShared.scheduledEvent.deleteNoInfo'),
        thumbnailComponent,
    };
};

const renderScheduledEventUserChange = async (
    input: GroupRendererInput,
    userLabel: string,
    emptyMessage: string,
): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const details: string[] = [];
    const eventId = str(input.eventData.scheduledEventId ?? input.eventData.eventId);
    const userId = str(input.eventData.userId);
    const eventName = str(input.eventData.eventName);

    if (eventName) {
        details.push(`${t(locale, 'logSearchShared.legacy.eventLabel')} ${eventName}`);
    } else if (eventId) {
        details.push(`${t(locale, 'logSearchShared.scheduledEvent.eventIdLabel')} ${eventId}`);
    }

    if (userId) {
        details.push(`**${userLabel}:** <@${userId}> (${userId})`);
    }

    const guild = input.interaction.guild;
    if (eventId && !eventName && guild) {
        try {
            const guildEvent = await guild.scheduledEvents.fetch(eventId);
            if (guildEvent.name) {
                details.unshift(
                    `${t(locale, 'logSearchShared.legacy.eventLabel')} ${guildEvent.name}`,
                );
            } else if (guildEvent.id) {
                details.unshift(
                    `${t(locale, 'logSearchShared.scheduledEvent.eventIdNameUnavailableLabel')} ${guildEvent.id}`,
                );
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

/**
 * 예약 이벤트 관련 타입별 렌더러를 분기 호출합니다.
 */
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
                t(
                    getInteractionLocale(input.interaction),
                    'logSearchShared.scheduledEvent.joinedUserLabel',
                ),
                t(
                    getInteractionLocale(input.interaction),
                    'logSearchShared.scheduledEvent.userAddNoInfo',
                ),
            );
        case 'guildScheduledEventUserRemove':
            return renderScheduledEventUserChange(
                input,
                t(
                    getInteractionLocale(input.interaction),
                    'logSearchShared.scheduledEvent.leftUserLabel',
                ),
                t(
                    getInteractionLocale(input.interaction),
                    'logSearchShared.scheduledEvent.userRemoveNoInfo',
                ),
            );
        default:
            return {
                eventSpecificsText: t(
                    getInteractionLocale(input.interaction),
                    'logSearchShared.legacy.noRecordedDetails',
                ),
            };
    }
}

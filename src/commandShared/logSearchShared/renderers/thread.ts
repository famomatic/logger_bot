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

/**
 * thread payload에서 표준 스레드 데이터 객체를 추출합니다.
 */
const getThreadData = (input: GroupRendererInput) =>
    isJsonData(input.eventData.thread)
        ? input.eventData.thread
        : isJsonData(input.eventData)
          ? input.eventData
          : undefined;

/**
 * threadCreate 로그의 상세 텍스트와 썸네일을 생성합니다.
 */
const renderThreadCreate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const details: string[] = [];
    const thread = getThreadData(input);

    if (thread) {
        details.push(
            `${t(locale, 'logSearchShared.legacy.threadNameLabel')} ${str(thread.name, 'N/A')} (<#${str(thread.id, t(locale, 'logSearchShared.role.idMissing'))}>)`,
        );
        if (thread.id) {
            details.push(`**ID:** ${str(thread.id)}`);
        }
        if (thread.parentId) {
            details.push(
                `${t(locale, 'logSearchShared.legacy.parentChannelLabel')} <#${str(thread.parentId)}>`,
            );
        }
        const ownerId = str(thread.ownerId);
        if (ownerId) {
            try {
                const owner = await input.interaction.client.users.fetch(ownerId);
                details.push(
                    `${t(locale, 'logSearchShared.legacy.creatorLabel')} ${owner.tag} (<@${ownerId}>)`,
                );
            } catch {
                details.push(`${t(locale, 'logSearchShared.legacy.creatorIdLabel')} ${ownerId}`);
            }
        }
        if (thread.autoArchiveDuration) {
            details.push(
                `${t(locale, 'logSearchShared.legacy.autoArchiveLabel')} ${num(thread.autoArchiveDuration) / 60}${t(locale, 'logSearchShared.legacy.minuteShort')}`,
            );
        }
    }

    const ownerIdForThumbnail = str(thread?.ownerId);
    const thumbnailComponent = ownerIdForThumbnail
        ? await buildUserThumbnail(input, ownerIdForThumbnail)
        : undefined;

    return {
        eventSpecificsText:
            details.length > 0
                ? details.join('\n')
                : t(locale, 'logSearchShared.thread.createNoInfo'),
        thumbnailComponent,
    };
};

/**
 * threadDelete 로그의 상세 텍스트와 썸네일을 생성합니다.
 */
const renderThreadDelete = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const details: string[] = [];
    const thread = getThreadData(input);

    if (thread) {
        details.push(
            `${t(locale, 'logSearchShared.legacy.deletedThreadNameLabel')} ${str(thread.name, 'N/A')}`,
        );
        if (thread.id) {
            details.push(`**ID:** ${str(thread.id)}`);
        }
        if (thread.parentId) {
            details.push(
                `${t(locale, 'logSearchShared.legacy.parentChannelLabel')} <#${str(thread.parentId)}>`,
            );
        }
    }

    return {
        eventSpecificsText:
            details.length > 0
                ? details.join('\n')
                : t(locale, 'logSearchShared.thread.deleteNoInfo'),
        thumbnailComponent: input.logUserId
            ? await buildUserThumbnail(input, input.logUserId)
            : undefined,
    };
};

/**
 * threadUpdate 로그의 변경 요약 텍스트와 썸네일을 생성합니다.
 */
const renderThreadUpdate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const locale = getInteractionLocale(input.interaction);
    const details: string[] = [];
    const oldThread = isJsonData(input.eventData.oldThread) ? input.eventData.oldThread : undefined;
    const newThreadCandidate = input.eventData.newThread ?? input.eventData.thread;
    const newThread = isJsonData(newThreadCandidate) ? newThreadCandidate : undefined;

    if (newThread) {
        details.push(
            `${t(locale, 'logSearchShared.legacy.threadLabel')} ${str(newThread.name, 'N/A')} (<#${str(newThread.id, t(locale, 'logSearchShared.role.idMissing'))}>)`,
        );
        if (oldThread) {
            if (oldThread.name !== newThread.name) {
                details.push(
                    `${t(locale, 'logSearchShared.legacy.nameChangedLabel')} \\\`${str(oldThread.name)}\\\` -> \\\`${str(newThread.name)}\\\``,
                );
            }
            if (oldThread.archived !== newThread.archived) {
                details.push(
                    `${t(locale, 'logSearchShared.legacy.archivedLabel')} ${oldThread.archived ? t(locale, 'logSearchShared.legacy.archived') : t(locale, 'logSearchShared.legacy.active')} -> ${newThread.archived ? t(locale, 'logSearchShared.legacy.archived') : t(locale, 'logSearchShared.legacy.active')}`,
                );
            }
            if (oldThread.locked !== newThread.locked) {
                details.push(
                    `${t(locale, 'logSearchShared.legacy.lockedLabel')} ${oldThread.locked ? t(locale, 'logSearchShared.legacy.locked') : t(locale, 'logSearchShared.legacy.disabled')} -> ${newThread.locked ? t(locale, 'logSearchShared.legacy.locked') : t(locale, 'logSearchShared.legacy.disabled')}`,
                );
            }
            if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration) {
                details.push(
                    `${t(locale, 'logSearchShared.legacy.autoArchiveChangedLabel')} ${num(oldThread.autoArchiveDuration) / 60}${t(locale, 'logSearchShared.legacy.minuteShort')} -> ${num(newThread.autoArchiveDuration) / 60}${t(locale, 'logSearchShared.legacy.minuteShort')}`,
                );
            }
        } else {
            details.push(t(locale, 'logSearchShared.thread.noPrevious'));
        }
    } else {
        details.push(t(locale, 'logSearchShared.thread.noInfo'));
    }

    return {
        eventSpecificsText:
            details.length > 0
                ? details.join('\n')
                : t(locale, 'logSearchShared.thread.updateNoInfo'),
        thumbnailComponent: input.logUserId
            ? await buildUserThumbnail(input, input.logUserId)
            : undefined,
    };
};

/**
 * 스레드 이벤트 타입별 렌더러를 분기 호출합니다.
 */
export async function renderThreadEvent(input: GroupRendererInput): Promise<GroupRendererResult> {
    switch (input.eventType) {
        case 'threadCreate':
            return renderThreadCreate(input);
        case 'threadDelete':
            return renderThreadDelete(input);
        case 'threadUpdate':
            return renderThreadUpdate(input);
        default:
            return {
                eventSpecificsText: t(
                    getInteractionLocale(input.interaction),
                    'logSearchShared.legacy.noRecordedDetails',
                ),
            };
    }
}

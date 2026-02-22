import { ThumbnailBuilder } from 'discord.js';
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

const getThreadData = (input: GroupRendererInput) =>
    isJsonData(input.eventData.thread) ? input.eventData.thread : input.eventData;

const renderThreadCreate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const details: string[] = [];
    const thread = getThreadData(input);

    if (thread) {
        details.push(`**스레드 이름:** ${str(thread.name, 'N/A')} (<#${str(thread.id, 'ID 없음')}>)`);
        if (thread.id) {
            details.push(`**ID:** ${str(thread.id)}`);
        }
        if (thread.parentId) {
            details.push(`**상위 채널:** <#${str(thread.parentId)}>`);
        }
        const ownerId = str(thread.ownerId);
        if (ownerId) {
            try {
                const owner = await input.interaction.client.users.fetch(ownerId);
                details.push(`**생성자:** ${owner.tag} (<@${ownerId}>)`);
            } catch {
                details.push(`**생성자 ID:** ${ownerId}`);
            }
        }
        if (thread.autoArchiveDuration) {
            details.push(`**자동 보관:** ${num(thread.autoArchiveDuration) / 60}분`);
        }
    }

    const ownerIdForThumbnail = str(thread.ownerId);
    const thumbnailComponent = ownerIdForThumbnail
        ? await buildUserThumbnail(input, ownerIdForThumbnail)
        : undefined;

    return {
        eventSpecificsText: details.length > 0 ? details.join('\n') : '스레드 생성 정보 없음',
        thumbnailComponent,
    };
};

const renderThreadDelete = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const details: string[] = [];
    const thread = getThreadData(input);

    if (thread) {
        details.push(`**삭제된 스레드 이름:** ${str(thread.name, 'N/A')}`);
        if (thread.id) {
            details.push(`**ID:** ${str(thread.id)}`);
        }
        if (thread.parentId) {
            details.push(`**상위 채널:** <#${str(thread.parentId)}>`);
        }
    }

    return {
        eventSpecificsText: details.length > 0 ? details.join('\n') : '스레드 삭제 정보 없음',
        thumbnailComponent:
            input.logUserId ? await buildUserThumbnail(input, input.logUserId) : undefined,
    };
};

const renderThreadUpdate = async (input: GroupRendererInput): Promise<GroupRendererResult> => {
    const details: string[] = [];
    const oldThread = isJsonData(input.eventData.oldThread) ? input.eventData.oldThread : undefined;
    const newThreadCandidate = input.eventData.newThread ?? input.eventData.thread;
    const newThread = isJsonData(newThreadCandidate) ? newThreadCandidate : undefined;

    if (newThread) {
        details.push(`**스레드:** ${str(newThread.name, 'N/A')} (<#${str(newThread.id, 'ID 없음')}>)`);
        if (oldThread) {
            if (oldThread.name !== newThread.name) {
                details.push(`**이름 변경:** \\\`${str(oldThread.name)}\\\` -> \\\`${str(newThread.name)}\\\``);
            }
            if (oldThread.archived !== newThread.archived) {
                details.push(
                    `**보관 상태:** ${oldThread.archived ? '보관됨' : '활성'} -> ${newThread.archived ? '보관됨' : '활성'}`,
                );
            }
            if (oldThread.locked !== newThread.locked) {
                details.push(
                    `**잠금 상태:** ${oldThread.locked ? '잠김' : '해제'} -> ${newThread.locked ? '잠김' : '해제'}`,
                );
            }
            if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration) {
                details.push(
                    `**자동 보관 변경:** ${num(oldThread.autoArchiveDuration) / 60}분 -> ${num(newThread.autoArchiveDuration) / 60}분`,
                );
            }
        } else {
            details.push('(이전 스레드 정보 없음)');
        }
    } else {
        details.push('스레드 정보 없음');
    }

    return {
        eventSpecificsText: details.length > 0 ? details.join('\n') : '스레드 업데이트 정보 없음',
        thumbnailComponent:
            input.logUserId ? await buildUserThumbnail(input, input.logUserId) : undefined,
    };
};

export async function renderThreadEvent(input: GroupRendererInput): Promise<GroupRendererResult> {
    switch (input.eventType) {
        case 'threadCreate':
            return renderThreadCreate(input);
        case 'threadDelete':
            return renderThreadDelete(input);
        case 'threadUpdate':
            return renderThreadUpdate(input);
        default:
            return { eventSpecificsText: '(기록된 세부 정보 없음)' };
    }
}

import { Events, AuditLogEvent } from 'discord.js';

import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { ThreadChannel, AuditLogChange } from 'discord.js';

// 변경된 내용을 사람이 읽기 쉬운 형태로 변환하는 헬퍼 함수
function formatThreadChange(change: AuditLogChange): string {
    const keyMap: Record<string, string> = {
        name: '이름',
        archived: '보관됨',
        auto_archive_duration: '자동 보관 기간',
        locked: '잠김',
        rate_limit_per_user: '슬로우 모드',
        // type: '타입' (Public/Private 변경은 보통 다른 이벤트)
    };
    const keyName = keyMap[change.key] ?? change.key;

    let oldValue =
        typeof change.old === 'object' ? JSON.stringify(change.old) : String(change.old ?? '');
    let newValue =
        typeof change.new === 'object' ? JSON.stringify(change.new) : String(change.new ?? '');

    // 예시: auto_archive_duration 값 변환 (분 단위)
    if (change.key === 'auto_archive_duration') {
        oldValue = `${oldValue}분`;
        newValue = `${newValue}분`;
    }

    return `${keyName}: '${oldValue}' -> '${newValue}'`;
}

const event = {
    name: Events.ThreadUpdate,
    async execute(oldThread: ThreadChannel, newThread: ThreadChannel) {
        // 주요 속성 변경 감지
        if (
            oldThread.name === newThread.name &&
            oldThread.archived === newThread.archived &&
            oldThread.locked === newThread.locked &&
            oldThread.autoArchiveDuration === newThread.autoArchiveDuration &&
            oldThread.rateLimitPerUser === newThread.rateLimitPerUser
        ) {
            return; // 주요 변경 없으면 종료
        }

        const eventType = 'threadUpdate';
        const guild = newThread.guild;
        const guildId = guild.id;
        const targetId = newThread.id; // 변경된 스레드 ID
        const parentChannelId = newThread.parentId;
        const timestamp = new Date();
        let executorId: string | null;
        let changesDescription: string;

        // Audit Log 조회 시도
        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 10,
                type: AuditLogEvent.ThreadUpdate, // 111
            });
            const updateLog = fetchedLogs.entries.find(
                (entry) =>
                    entry.target.id === targetId &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 15000,
            );

            if (updateLog) {
                executorId = updateLog.executor?.id ?? null;
                changesDescription = updateLog.changes.map(formatThreadChange).join('\n');
                if (!changesDescription) {
                    changesDescription = '변경 내역을 Audit Log에서 찾을 수 없음';
                }
            } else {
                executorId = null;
                logger.warn(
                    `Could not find exact Audit Log entry for ${eventType} (thread ${targetId}) in guild ${guildId}. Executor and precise changes might be missing.`,
                );
                // Audit Log 못 찾으면 직접 비교 결과 사용
                const detectedChanges: string[] = [];
                if (oldThread.name !== newThread.name)
                    detectedChanges.push(`이름: '${oldThread.name}' -> '${newThread.name}'`);
                if (oldThread.archived !== newThread.archived)
                    detectedChanges.push(
                        `보관됨: ${String(oldThread.archived ?? '')} -> ${String(newThread.archived ?? '')}`,
                    );
                if (oldThread.locked !== newThread.locked)
                    detectedChanges.push(
                        `잠김: ${String(oldThread.locked ?? '')} -> ${String(newThread.locked ?? '')}`,
                    );
                if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration)
                    detectedChanges.push(
                        `자동 보관 기간: ${String(oldThread.autoArchiveDuration ?? '')}분 -> ${String(newThread.autoArchiveDuration ?? '')}분`,
                    );
                if (oldThread.rateLimitPerUser !== newThread.rateLimitPerUser)
                    detectedChanges.push(
                        `슬로우 모드: ${String(oldThread.rateLimitPerUser ?? '')}초 -> ${String(newThread.rateLimitPerUser ?? '')}초`,
                    );
                changesDescription = detectedChanges.join('\n');
            }
        } catch (error) {
            executorId = null;
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
            // 에러 시 직접 비교 결과 사용
            const detectedChanges: string[] = [];
            if (oldThread.name !== newThread.name)
                detectedChanges.push(`이름: '${oldThread.name}' -> '${newThread.name}'`);
            if (oldThread.archived !== newThread.archived)
                detectedChanges.push(
                    `보관됨: ${String(oldThread.archived ?? '')} -> ${String(newThread.archived ?? '')}`,
                );
            if (oldThread.locked !== newThread.locked)
                detectedChanges.push(
                    `잠김: ${String(oldThread.locked ?? '')} -> ${String(newThread.locked ?? '')}`,
                );
            if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration)
                detectedChanges.push(
                    `자동 보관 기간: ${String(oldThread.autoArchiveDuration ?? '')}분 -> ${String(newThread.autoArchiveDuration ?? '')}분`,
                );
            if (oldThread.rateLimitPerUser !== newThread.rateLimitPerUser)
                detectedChanges.push(
                    `슬로우 모드: ${String(oldThread.rateLimitPerUser ?? '')}초 -> ${String(newThread.rateLimitPerUser ?? '')}초`,
                );
            changesDescription = detectedChanges.join('\n');
        }

        // 변경 사항이 없으면 (오류 발생 후에도) 로깅하지 않음
        if (!changesDescription) {
            // logger.debug(`No detectable changes for ${eventType} (thread ${targetId})`);
            return;
        }

        const dataToStore = {
            threadId: targetId,
            threadName: newThread.name,
            parentId: parentChannelId,
            parentName: newThread.parent?.name,
            changes: changesDescription,
            executorUserId: executorId,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId,
                parentChannelId,
                targetId,
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for thread ${newThread.name} (${targetId}) in guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event for thread ${targetId}:`,
                error,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export { event };

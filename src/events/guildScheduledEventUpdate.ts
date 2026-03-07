import {
    Events,
    GuildScheduledEventEntityType,
    GuildScheduledEventStatus,
    AuditLogEvent,
} from 'discord.js';

import { fetchAuditLogsCached } from '../utils/auditLogCache.js';
import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { GuildScheduledEvent, AuditLogChange } from 'discord.js';

// Enum 헬퍼 함수 (Create/Delete와 동일)
// 실제 구현에서는 이 함수들을 별도 유틸리티 파일로 분리하는 것이 좋습니다.
function getEntityTypeString(type: GuildScheduledEventEntityType): string {
    switch (type) {
        case GuildScheduledEventEntityType.StageInstance:
            return 'StageInstance';
        case GuildScheduledEventEntityType.Voice:
            return 'Voice';
        case GuildScheduledEventEntityType.External:
            return 'External';
        default:
            return 'Unknown';
    }
}
function getStatusString(status: GuildScheduledEventStatus): string {
    switch (status) {
        case GuildScheduledEventStatus.Active:
            return 'Active';
        case GuildScheduledEventStatus.Canceled:
            return 'Canceled';
        case GuildScheduledEventStatus.Completed:
            return 'Completed';
        case GuildScheduledEventStatus.Scheduled:
            return 'Scheduled';
        default:
            return 'Unknown';
    }
}

// 변경 내용 포맷터
function formatScheduledEventChange(change: AuditLogChange): string {
    const keyMap: Record<string, string> = {
        name: '이름',
        description: '설명',
        channel_id: '채널',
        entity_type: '타입',
        location: '위치', // entityMetadata.location 키 확인 필요
        status: '상태',
        image_hash: '커버 이미지',
        // scheduled_start_time, scheduled_end_time 키는 타입 오류로 제거
    };
    const keyName = keyMap[change.key] ?? change.key;
    let oldValue =
        typeof change.old === 'object' ? JSON.stringify(change.old) : String(change.old ?? '없음');
    let newValue =
        typeof change.new === 'object' ? JSON.stringify(change.new) : String(change.new ?? '없음');

    if (change.key === 'status') {
        if (change.old != null)
            oldValue = getStatusString(Number(change.old) as GuildScheduledEventStatus);
        if (change.new != null)
            newValue = getStatusString(Number(change.new) as GuildScheduledEventStatus);
    } else if (change.key === 'entity_type') {
        if (change.old != null)
            oldValue = getEntityTypeString(Number(change.old) as GuildScheduledEventEntityType);
        if (change.new != null)
            newValue = getEntityTypeString(Number(change.new) as GuildScheduledEventEntityType);
    } else if (change.key === 'channel_id') {
        oldValue = String(change.old ?? '없음');
        newValue = String(change.new ?? '없음');
    }
    return `${keyName}: '${oldValue}' -> '${newValue}'`;
}

const event = {
    name: Events.GuildScheduledEventUpdate,
    async execute(
        oldGuildScheduledEvent: GuildScheduledEvent | null,
        newGuildScheduledEvent: GuildScheduledEvent,
    ) {
        // --- 디버깅 로그 주석 처리 ---
        // logger.info(`Received ${Events.GuildScheduledEventUpdate} event for event ID: ${newGuildScheduledEvent.id}`);
        // -------------------------

        if (!oldGuildScheduledEvent || !newGuildScheduledEvent.guild) {
            logger.warn(
                `GuildScheduledEventUpdate: Old event data missing or event not in a guild for event ID: ${newGuildScheduledEvent.id}`,
            );
            return;
        }

        // 주요 속성 변경 감지
        if (
            oldGuildScheduledEvent.name === newGuildScheduledEvent.name &&
            oldGuildScheduledEvent.description === newGuildScheduledEvent.description &&
            oldGuildScheduledEvent.scheduledStartTimestamp ===
                newGuildScheduledEvent.scheduledStartTimestamp &&
            oldGuildScheduledEvent.scheduledEndTimestamp ===
                newGuildScheduledEvent.scheduledEndTimestamp &&
            oldGuildScheduledEvent.channelId === newGuildScheduledEvent.channelId &&
            oldGuildScheduledEvent.entityType === newGuildScheduledEvent.entityType &&
            oldGuildScheduledEvent.entityMetadata?.location ===
                newGuildScheduledEvent.entityMetadata?.location &&
            oldGuildScheduledEvent.status === newGuildScheduledEvent.status &&
            oldGuildScheduledEvent.image === newGuildScheduledEvent.image
        ) {
            return; // 주요 변경 없으면 종료
        }

        const eventType = 'guildScheduledEventUpdate';
        const guild = newGuildScheduledEvent.guild;
        const guildId = guild.id;
        const targetId = newGuildScheduledEvent.id;
        const channelId = newGuildScheduledEvent.channelId;
        const timestamp = new Date();
        let executorId: string | null;
        let changesDescription: string;

        try {
            const fetchedLogs = await fetchAuditLogsCached(guild, {
                limit: 5,
                type: AuditLogEvent.GuildScheduledEventUpdate, // 101
                ttlMs: 2_000,
            });
            const updateLog = fetchedLogs.entries.find(
                (entry) =>
                    entry.targetId === targetId &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );

            if (updateLog?.changes) {
                executorId = updateLog.executor?.id ?? null;
                changesDescription = updateLog.changes.map(formatScheduledEventChange).join('\n');
                if (!changesDescription)
                    changesDescription = '변경 내역을 Audit Log에서 파싱할 수 없음';
            } else {
                executorId = null;
                logger.warn(
                    `Could not find exact Audit Log entry or changes for ${eventType} (event ${targetId}) in guild ${guildId}. Executor and precise changes might be missing.`,
                );
                // Audit Log 못 찾으면 직접 비교 결과 사용
                const detectedChanges: string[] = [];
                if (oldGuildScheduledEvent.name !== newGuildScheduledEvent.name)
                    detectedChanges.push(
                        `이름: '${oldGuildScheduledEvent.name}' -> '${newGuildScheduledEvent.name}'`,
                    );
                if (oldGuildScheduledEvent.description !== newGuildScheduledEvent.description)
                    detectedChanges.push(
                        `설명: '${oldGuildScheduledEvent.description ?? ''}' -> '${newGuildScheduledEvent.description ?? ''}'`,
                    );
                if (
                    oldGuildScheduledEvent.scheduledStartTimestamp !==
                    newGuildScheduledEvent.scheduledStartTimestamp
                )
                    detectedChanges.push(`시작 시간 변경됨`);
                if (
                    oldGuildScheduledEvent.scheduledEndTimestamp !==
                    newGuildScheduledEvent.scheduledEndTimestamp
                )
                    detectedChanges.push(`종료 시간 변경됨`);
                if (oldGuildScheduledEvent.channelId !== newGuildScheduledEvent.channelId)
                    detectedChanges.push(
                        `채널 변경됨: ${oldGuildScheduledEvent.channelId ?? '없음'} -> ${newGuildScheduledEvent.channelId ?? '없음'}`,
                    );
                if (oldGuildScheduledEvent.entityType !== newGuildScheduledEvent.entityType)
                    detectedChanges.push(`타입 변경됨`);
                if (
                    oldGuildScheduledEvent.entityMetadata?.location !==
                    newGuildScheduledEvent.entityMetadata?.location
                )
                    detectedChanges.push(`위치 변경됨`);
                if (oldGuildScheduledEvent.status !== newGuildScheduledEvent.status)
                    detectedChanges.push(
                        `상태 변경됨: ${getStatusString(oldGuildScheduledEvent.status)} -> ${getStatusString(newGuildScheduledEvent.status)}`,
                    );
                if (oldGuildScheduledEvent.image !== newGuildScheduledEvent.image)
                    detectedChanges.push(`커버 이미지 변경됨`);
                changesDescription = detectedChanges.join('\n');
            }
        } catch (error) {
            executorId = null;
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
            // 오류 발생 시에도 직접 비교한 내용 fallback 적용
            const detectedChanges: string[] = [];
            if (oldGuildScheduledEvent.name !== newGuildScheduledEvent.name)
                detectedChanges.push(
                    `이름: '${oldGuildScheduledEvent.name}' -> '${newGuildScheduledEvent.name}'`,
                );
            // ... (다른 필드 비교) ...
            if (oldGuildScheduledEvent.status !== newGuildScheduledEvent.status)
                detectedChanges.push(
                    `상태 변경됨: ${getStatusString(oldGuildScheduledEvent.status)} -> ${getStatusString(newGuildScheduledEvent.status)}`,
                );
            changesDescription = detectedChanges.join('\n');
        }

        if (!changesDescription) {
            return;
        }

        const dataToStore = {
            eventId: targetId,
            eventName: newGuildScheduledEvent.name,
            changes: changesDescription,
            executorUserId: executorId,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId,
                channelId,
                targetId,
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for scheduled event ${newGuildScheduledEvent.name} (${targetId}) in guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event for scheduled event ${targetId}:`,
                error,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export { event };

import {
    Events,
    GuildScheduledEventEntityType,
    GuildScheduledEventStatus,
    AuditLogEvent,
} from 'discord.js';

import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { GuildScheduledEvent } from 'discord.js';

// Enum 헬퍼 함수
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

const event = {
    name: Events.GuildScheduledEventDelete,
    async execute(guildScheduledEvent: GuildScheduledEvent) {
        // --- 디버깅 로그 주석 처리 ---
        // logger.info(`Received ${Events.GuildScheduledEventDelete} event for event ID: ${guildScheduledEvent.id}`);
        // -------------------------
        if (!guildScheduledEvent.guild) return;

        const eventType = 'guildScheduledEventDelete';
        const guild = guildScheduledEvent.guild;
        const guildId = guild.id;
        const targetId = guildScheduledEvent.id; // 삭제된 이벤트 ID
        const channelId = guildScheduledEvent.channelId;
        const timestamp = new Date();
        let executorId: string | null = null;

        // 삭제된 이벤트 정보 (삭제 직전)
        const deletedEventInfo = {
            eventId: targetId,
            eventName: guildScheduledEvent.name,
            description: guildScheduledEvent.description,
            channelId: channelId,
            channelName: guildScheduledEvent.channel?.name,
            entityType: getEntityTypeString(guildScheduledEvent.entityType),
            entityLocation: guildScheduledEvent.entityMetadata?.location,
            scheduledStartTime: guildScheduledEvent.scheduledStartTimestamp
                ? new Date(guildScheduledEvent.scheduledStartTimestamp).toISOString()
                : null,
            scheduledEndTime: guildScheduledEvent.scheduledEndTimestamp
                ? new Date(guildScheduledEvent.scheduledEndTimestamp).toISOString()
                : null,
            status: getStatusString(guildScheduledEvent.status), // 삭제 시점의 상태 (보통 Canceled or Completed)
            creatorId: guildScheduledEvent.creatorId,
            creatorTag: guildScheduledEvent.creator?.tag,
            createdAt: guildScheduledEvent.createdTimestamp
                ? new Date(guildScheduledEvent.createdTimestamp).toISOString()
                : null,
        };

        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.GuildScheduledEventDelete, // 102
            });
            const deleteLog = fetchedLogs.entries.first();
            if (
                deleteLog?.target.id === targetId &&
                Math.abs(Date.now() - deleteLog.createdTimestamp) < 5000
            ) {
                executorId = deleteLog.executor?.id ?? null;
            } else {
                logger.warn(
                    `Could not confirm executor for ${eventType} (event ${targetId}) in guild ${guildId} via Audit Log.`,
                );
            }
        } catch (error) {
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
        }

        const dataToStore = {
            deletedEvent: deletedEventInfo,
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
                `Logged ${eventType} event for scheduled event ${deletedEventInfo.eventName} (${targetId}) in guild ${guildId}`,
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

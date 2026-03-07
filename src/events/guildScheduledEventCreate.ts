import {
    Events,
    GuildScheduledEventEntityType,
    GuildScheduledEventStatus,
    AuditLogEvent,
} from 'discord.js';

import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { GuildScheduledEvent } from 'discord.js';

// Enum 값들을 문자열로 변환하는 헬퍼
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
    name: Events.GuildScheduledEventCreate,
    async execute(guildScheduledEvent: GuildScheduledEvent) {
        // --- 디버깅 로그 주석 처리 ---
        // logger.info(`Received ${Events.GuildScheduledEventCreate} event for event ID: ${guildScheduledEvent.id}`);
        // -------------------------
        if (!guildScheduledEvent.guild) return;

        const eventType = 'guildScheduledEventCreate';
        const guild = guildScheduledEvent.guild;
        const guildId = guild.id;
        const targetId = guildScheduledEvent.id; // 생성된 이벤트 ID
        const creatorId = guildScheduledEvent.creatorId;
        const channelId = guildScheduledEvent.channelId; // 음성/스테이지 채널 ID or null
        const timestamp = guildScheduledEvent.createdTimestamp
            ? new Date(guildScheduledEvent.createdTimestamp)
            : new Date();
        let executorId: string | null;

        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.GuildScheduledEventCreate, // 100
            });
            const createLog = fetchedLogs.entries.first();
            if (
                createLog?.target.id === targetId &&
                Math.abs(Date.now() - createLog.createdTimestamp) < 5000
            ) {
                executorId = createLog.executor?.id ?? null;
            } else {
                executorId = creatorId; // Audit Log 없으면 생성자를 실행자로 간주
                logger.warn(
                    `Could not confirm executor for ${eventType} (event ${targetId}) in guild ${guildId} via Audit Log. Assuming creator is executor.`,
                );
            }
        } catch (error) {
            executorId = creatorId; // 에러 시 생성자를 실행자로 간주
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
        }

        const dataToStore = {
            eventId: targetId,
            eventName: guildScheduledEvent.name,
            description: guildScheduledEvent.description,
            channelId: channelId,
            channelName: guildScheduledEvent.channel?.name, // 채널 이름 가져오기 시도
            entityType: getEntityTypeString(guildScheduledEvent.entityType),
            entityLocation: guildScheduledEvent.entityMetadata?.location, // 외부 URL 등
            scheduledStartTime: guildScheduledEvent.scheduledStartTimestamp
                ? new Date(guildScheduledEvent.scheduledStartTimestamp).toISOString()
                : null,
            scheduledEndTime: guildScheduledEvent.scheduledEndTimestamp
                ? new Date(guildScheduledEvent.scheduledEndTimestamp).toISOString()
                : null,
            status: getStatusString(guildScheduledEvent.status),
            creatorId: creatorId,
            creatorTag: guildScheduledEvent.creator?.tag,
            executorUserId: executorId,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId ?? creatorId,
                channelId,
                targetId,
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for scheduled event ${guildScheduledEvent.name} (${targetId}) in guild ${guildId}`,
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

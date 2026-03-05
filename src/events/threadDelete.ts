import { Events, ThreadChannel, AuditLogEvent, ChannelType } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';

const event = {
    name: Events.ThreadDelete,
    async execute(thread: ThreadChannel) {
        const eventType = 'threadDelete';
        const guild = thread.guild;
        const guildId = guild.id;
        const targetId = thread.id; // 삭제된 스레드 ID
        const parentChannelId = thread.parentId;
        const timestamp = new Date();
        let executorId: string | null = null;

        // 삭제된 스레드 정보 (삭제 직전)
        const deletedThreadInfo = {
            id: targetId,
            name: thread.name,
            parentId: parentChannelId,
            parentName: thread.parent?.name,
            ownerId: thread.ownerId,
            type: ChannelType[thread.type],
            createdAt: thread.createdAt?.toISOString(),
        };

        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.ThreadDelete, // 112
            });
            const deleteLog = fetchedLogs.entries.first();
            // Audit Log의 target이 삭제된 스레드와 일치하는지 확인
            if (
                deleteLog &&
                deleteLog.target?.id === targetId &&
                Math.abs(Date.now() - deleteLog.createdTimestamp) < 5000
            ) {
                executorId = deleteLog.executor?.id ?? null;
            } else {
                logger.warn(
                    `Could not confirm executor for ${eventType} (thread ${targetId}) in guild ${guildId} via Audit Log.`,
                );
            }
        } catch (error) {
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
        }

        const dataToStore = {
            deletedThread: deletedThreadInfo,
            executorUserId: executorId,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId, // user_id: 실행자
                parentChannelId, // channel_id: 부모 채널
                targetId, // target_id: 삭제된 스레드
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for thread ${deletedThreadInfo.name} (${targetId}) in guild ${guildId}`,
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
export default event;

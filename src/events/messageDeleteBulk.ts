import {
    Events,
    Collection,
    Message,
    PartialMessage,
    GuildTextBasedChannel,
    AuditLogEvent,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

const event = {
    name: Events.MessageBulkDelete,
    async execute(
        messages: Collection<string, Message | PartialMessage>,
        channel: GuildTextBasedChannel,
    ) {
        const eventType = 'messageDeleteBulk';
        const guildId = channel.guild.id;
        const channelId = channel.id;
        const deletedCount = messages.size;
        const timestamp = new Date();
        let executorId: string | null = null;

        if (deletedCount === 0) {
            logger.warn(
                `Received ${eventType} event with 0 messages in channel ${channelId} of guild ${guildId}. Skipping log.`,
            );
            return; // 삭제된 메시지가 없으면 로깅하지 않음
        }

        // Audit Log 조회 시도 (대량 삭제 실행자 확인)
        try {
            const fetchedLogs = await channel.guild.fetchAuditLogs({
                limit: 5,
                type: AuditLogEvent.MessageBulkDelete,
            });

            // 채널 ID가 같고, 삭제된 메시지 수가 일치하는 가장 최근 로그를 찾음
            // AuditLog는 약간의 지연이 있을 수 있음
            const deleteLog = fetchedLogs.entries.find(
                (entry) => entry.targetId === channelId && entry.extra?.count === deletedCount,
            );

            if (deleteLog) {
                executorId = deleteLog.executor?.id ?? null;
                // timestamp = deleteLog.createdAt; // Audit Log 시간 사용 가능
            } else {
                logger.warn(
                    `Could not find matching Audit Log entry for ${eventType} (${deletedCount} messages) in channel ${channelId} of guild ${guildId}. Executor info might be missing.`,
                );
            }
        } catch (error) {
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
        }

        // 삭제된 메시지들의 상세 정보 추출 (ID, 작성자 ID, 내용)
        const deletedMessagesDetails = messages.map((msg) => {
            // 메시지가 부분적이거나 내용이 없는 경우 처리
            const content = !msg.partial && msg.content ? msg.content : '[Content Unavailable]';
            // 메시지 작성자가 없는 경우 처리 (이론상으로는 드물지만 안전하게 처리)
            const authorId = msg.author?.id ?? '[Unknown Author]';
            return {
                id: msg.id,
                authorId: authorId,
                content: content, // 메시지 내용 또는 대체 텍스트
            };
        });

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            channelId: channelId,
            deletedCount: deletedCount,
            executorUserId: executorId,
            deletedMessages: deletedMessagesDetails, // 추출한 메시지 상세 정보 배열 추가
            // deletedMessageIds: messages.map(msg => msg.id) // ID 목록은 deletedMessagesDetails에 포함되므로 주석 처리 또는 제거 가능
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId, // user_id: 대량 삭제 실행자
                channelId, // channel_id: 메시지가 삭제된 채널
                null, // target_id: 특정 대상 없음
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event (${deletedCount} messages) in channel ${channelId} of guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event in channel ${channelId}:`,
                error,
            );
        }
    },
} as const;

export default event;

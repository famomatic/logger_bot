import { Events, TextBasedChannel, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

const event = {
    name: Events.ChannelPinsUpdate,
    // time 파라미터는 핀이 마지막으로 업데이트된 시각 (Date)
    async execute(channel: TextBasedChannel, time: Date) {
        // DM 채널 등 길드가 없는 채널은 무시
        if (!channel.isDMBased() && channel.guild) {
            const guild = channel.guild;
            const guildId = guild.id;
            const channelId = channel.id;
            const timestamp = new Date(time); // Ensure it is a Date object
            const eventType = 'channelPinsUpdate';

            let executorId: string | null = null;
            let targetUserId: string | null = null; // 메시지 작성자
            let messageId: string | null = null;
            let actionType: 'pin' | 'unpin' | 'unknown' = 'unknown';

            try {
                const fetchedLogs = await guild.fetchAuditLogs({
                    limit: 5,
                    // type: [AuditLogEvent.MessagePin, AuditLogEvent.MessageUnpin] // v14.7+
                });

                // 채널 ID가 같고, 이벤트 시간과 가장 가까운 핀/언핀 로그 찾기
                const pinLog = fetchedLogs.entries
                    .filter(
                        (entry) =>
                            (entry.action === AuditLogEvent.MessagePin ||
                                entry.action === AuditLogEvent.MessageUnpin) &&
                            entry.extra &&
                            'channel' in entry.extra &&
                            entry.extra.channel?.id === channelId,
                    )
                    .sort((a, b) => b.createdTimestamp - a.createdTimestamp) // 최신 로그부터
                    .find((entry) => Math.abs(timestamp.getTime() - entry.createdTimestamp) < 5000); // 5초 이내

                if (pinLog) {
                    executorId = pinLog.executor?.id ?? null;
                    // target은 User 객체여야 함 (타입 및 속성 존재 확인 강화)
                    targetUserId =
                        pinLog.target &&
                        typeof pinLog.target === 'object' &&
                        'id' in pinLog.target &&
                        typeof pinLog.target.id === 'string'
                            ? pinLog.target.id
                            : null;
                    // extra에 messageId가 있는지 확인
                    messageId =
                        pinLog.extra &&
                        typeof pinLog.extra === 'object' &&
                        'messageId' in pinLog.extra &&
                        typeof pinLog.extra.messageId === 'string'
                            ? pinLog.extra.messageId
                            : null;
                    actionType = pinLog.action === AuditLogEvent.MessagePin ? 'pin' : 'unpin';
                } else {
                    logger.warn(
                        `Could not find Audit Log for ${eventType} in channel ${channelId} around ${timestamp.toISOString()}. Details might be missing.`,
                    );
                    // Audit Log를 못 찾으면 실행자 등을 알 수 없음
                }
            } catch (error) {
                logger.error(
                    `Failed to fetch Audit Logs for ${eventType} in channel ${channelId}:`,
                    error,
                );
            }

            const dataToStore = {
                channelId: channelId,
                channelName: 'name' in channel ? channel.name : channelId, // 채널 이름 가져오기 시도
                action: actionType, // 'pin' or 'unpin'
                executorUserId: executorId,
                targetUserId: targetUserId, // 메시지 작성자
                messageId: messageId, // 고정/해제된 메시지 ID (Audit Log에서)
            };

            try {
                await logEvent(
                    eventType,
                    guildId,
                    executorId, // user_id: 실행자
                    channelId,
                    targetUserId, // target_id: 메시지 작성자 ID (pinLog.target.id)
                    dataToStore,
                    timestamp,
                );
                logger.debug(
                    `Logged ${eventType} event in channel ${channelId} of guild ${guildId}`,
                );
            } catch (error) {
                logger.error(
                    `Error occurred while trying to log ${eventType} event for channel ${channelId}:`,
                    error,
                );
            }
        }
    },
} as const;

export default event;

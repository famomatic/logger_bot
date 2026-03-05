import { Events, GuildChannel, ChannelType, DMChannel, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';

// 채널 타입 이름을 문자열로 변환하는 헬퍼 함수 (channelCreate와 동일하게 사용 가능)
// 실제로는 별도 유틸리티 파일로 분리하는 것이 더 좋음
function getChannelTypeName(type: ChannelType): string {
    switch (type) {
        case ChannelType.GuildText:
            return 'Text';
        case ChannelType.GuildVoice:
            return 'Voice';
        case ChannelType.GuildCategory:
            return 'Category';
        case ChannelType.GuildAnnouncement:
            return 'Announcement';
        case ChannelType.AnnouncementThread:
            return 'AnnouncementThread';
        case ChannelType.PublicThread:
            return 'PublicThread';
        case ChannelType.PrivateThread:
            return 'PrivateThread';
        case ChannelType.GuildStageVoice:
            return 'StageVoice';
        case ChannelType.GuildDirectory:
            return 'Directory';
        case ChannelType.GuildForum:
            return 'Forum';
        case ChannelType.GuildMedia:
            return 'Media';
        // DMChannel 등 다른 타입 추가 가능
        case ChannelType.DM:
            return 'DM';
        case ChannelType.GroupDM:
            return 'GroupDM';
        default:
            return `Unknown (${String(type)})`;
    }
}

const event = {
    name: Events.ChannelDelete,
    async execute(channel: DMChannel | GuildChannel) {
        // 길드가 없는 채널(DM 등)은 guildId가 없음
        const guild = channel.isDMBased() ? null : channel.guild;
        if (!guild) {
            // DM 채널 삭제 등 길드 외부 이벤트는 일단 무시 (필요시 로깅 추가)
            // logger.debug(`Ignoring channel delete event for non-guild channel ${channel.id}`);
            return;
        }
        const guildId = guild.id;

        const eventType = 'channelDelete';
        const channelId = channel.id; // 삭제된 채널 ID
        const timestamp = new Date(); // 이벤트 발생 시각
        let executorId: string | null = null;
        // const targetId = channelId; // target_id로 channelId 사용

        // Audit Log 조회 시도 (채널 삭제 실행자 확인)
        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 5,
                type: AuditLogEvent.ChannelDelete, // 12
            });
            // targetId가 삭제된 채널 ID와 일치하는 로그 찾기
            const deleteLog = fetchedLogs.entries.find(
                (entry) =>
                    entry.target?.id === channelId &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );
            if (deleteLog) {
                executorId = deleteLog.executor?.id ?? null;
                // timestamp = deleteLog.createdAt; // Audit Log 시간 사용 가능
            } else {
                logger.warn(
                    `Could not find matching Audit Log for ${eventType} on channel ${channelId}. Executor info might be missing.`,
                );
            }
        } catch (error) {
            logger.error(
                `Failed to fetch Audit Logs for ${eventType} on channel ${channelId}:`,
                error,
            );
        }

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            deletedChannelId: channelId,
            channelName: channel.isDMBased() ? 'DM Channel' : channel.name, // DM이면 이름이 없을 수 있음
            channelType: getChannelTypeName(channel.type),
            executorUserId: executorId,
            // parentId: channel.isDMBased() ? null : channel.parentId, // 삭제 시점 정보
        };

        // Remove old query logic
        // 데이터베이스에 로그 기록
        // const insertQuery = `
        //   INSERT INTO event_logs (event_type, guild_id, channel_id, user_id, target_id, timestamp, data)
        //   VALUES ($1, $2, $3, $4, $5, $6, $7)
        // `;
        // // channel_id에는 null 저장 (채널이 삭제되었으므로 특정 채널에서 발생한 이벤트가 아님)
        // const values = [
        //   eventType,
        //   guildId,
        //   null, // 이벤트 발생 채널 ID는 null
        //   executorId, // userId is executorId
        //   channelId, // targetId is channelId
        //   timestamp,
        //   JSON.stringify(dataToStore),
        // ];

        try {
            // await query(insertQuery, values);
            // Call logEvent instead
            await logEvent(
                eventType,
                guildId,
                executorId, // user_id: 채널 삭제 실행자
                null, // channel_id: 이벤트 발생 채널 없음 (채널 자체가 삭제됨)
                channelId, // target_id: 삭제된 채널 ID
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for channel ${channelId} (${dataToStore.channelName}) in guild ${guildId}`,
            );
        } catch (error) {
            // logEvent 내부에서 에러 로깅이 이미 수행됨.
            logger.error(
                `Error occurred while trying to log ${eventType} event for channel ${channelId}:`,
                error,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export default event;

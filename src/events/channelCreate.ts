import { Events, ChannelType, AuditLogEvent } from 'discord.js';

import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { GuildChannel } from 'discord.js';

// 채널 타입 이름을 문자열로 변환하는 헬퍼 함수
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
        default:
            return `Unknown (${type})`;
    }
}

const event = {
    name: Events.ChannelCreate,
    async execute(channel: GuildChannel) {
        // DM 채널 등 길드 외부 채널은 이 이벤트에서 처리되지 않음 (GuildChannel 타입)

        const eventType = 'channelCreate';
        const guild = channel.guild;
        const guildId = guild.id;
        const channelId = channel.id; // 생성된 채널 ID
        const timestamp = channel.createdAt;
        let executorId: string | null = null;

        // Audit Log 조회 시도 (채널 생성 실행자 확인)
        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 5,
                type: AuditLogEvent.ChannelCreate, // 10
            });
            // targetId가 생성된 채널 ID와 일치하는 로그 찾기
            const createLog = fetchedLogs.entries.find(
                (entry) =>
                    entry.target.id === channelId &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );
            if (createLog) {
                executorId = createLog.executor?.id ?? null;
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
            channelId: channelId,
            channelName: channel.name,
            channelType: getChannelTypeName(channel.type),
            parentId: channel.parentId, // 카테고리 ID (있을 경우)
            position: channel.position,
            executorUserId: executorId,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId,
                channelId,
                channelId,
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for channel ${channelId} (${channel.name}) in guild ${guildId}`,
            );
        } catch (error) {
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
export { event };

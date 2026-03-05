import { Events, GuildChannel, ChannelType, DMChannel, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';

// 채널 타입 이름을 문자열로 변환하는 헬퍼 함수 (다른 파일에서 가져오는 것이 좋음)
function getChannelTypeName(type: ChannelType): string {
    switch (type) {
        case ChannelType.GuildText:
            return 'Text';
        case ChannelType.GuildVoice:
            return 'Voice';
        // ... (다른 타입들 추가) ...
        case ChannelType.GuildForum:
            return 'Forum';
        case ChannelType.GuildMedia:
            return 'Media';
        case ChannelType.DM:
            return 'DM';
        case ChannelType.GroupDM:
            return 'GroupDM';
        default:
            return `Unknown (${type})`;
    }
}

// 채널 객체에서 로깅할 주요 정보 추출하는 함수
function extractChannelInfo(channel: DMChannel | GuildChannel): Record<string, unknown> {
    const baseInfo = {
        channelId: channel.id,
        channelType: getChannelTypeName(channel.type),
    };
    if (channel.isDMBased()) {
        return { ...baseInfo, channelName: 'DM Channel' };
    }
    // GuildChannel인 경우 추가 정보 포함
    return {
        ...baseInfo,
        channelName: channel.name,
        parentId: channel.parentId,
        position: channel.position,
        topic: 'topic' in channel ? channel.topic : null, // TextChannel 등에만 존재
        nsfw: 'nsfw' in channel ? channel.nsfw : null, // TextChannel 등에만 존재
        bitrate: 'bitrate' in channel ? channel.bitrate : null, // VoiceChannel 등에만 존재
        userLimit: 'userLimit' in channel ? channel.userLimit : null, // VoiceChannel 등에만 존재
        // 필요에 따라 더 많은 속성 추가 (e.g., permissionOverwrites)
    };
}

const event = {
    name: Events.ChannelUpdate,
    async execute(oldChannel: DMChannel | GuildChannel, newChannel: DMChannel | GuildChannel) {
        // 길드 외부 채널 변경은 무시 (예: DM 채널 이름 변경 불가)
        const guild = newChannel.isDMBased() ? null : newChannel.guild;
        if (!guild) {
            return;
        }
        const guildId = guild.id;

        const eventType = 'channelUpdate';
        const channelId = newChannel.id; // 업데이트된 채널 ID
        const timestamp = new Date();
        let executorId: string | null = null;

        // 변경 전/후 정보 추출
        const oldData = extractChannelInfo(oldChannel);
        const newData = extractChannelInfo(newChannel);

        // 실제로 변경된 내용만 필터링 (선택적, data 크기 줄이기)
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const key in newData) {
            if (oldData[key] !== newData[key]) {
                changes[key] = { old: oldData[key], new: newData[key] };
            }
        }

        // 변경 사항이 없거나 위치만 바뀐 경우(Audit Log가 남지 않음)에는 무시
        const changeKeys = Object.keys(changes);
        if (changeKeys.length === 0) {
            return;
        }
        if (changeKeys.length === 1 && changeKeys[0] === 'position') {
            return;
        }

        // Audit Log 조회 시도 (채널 업데이트 실행자 확인)
        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 5,
                type: AuditLogEvent.ChannelUpdate, // 11
            });
            // 채널 ID가 일치하고 변경 사항 키가 일치하는 로그 찾기
            const updateLog = fetchedLogs.entries.find(
                (entry) =>
                    entry.target?.id === channelId &&
                    entry.changes?.some((c) => changes[c.key] !== undefined) && // 실제 변경된 내용과 관련된 로그인지 확인
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );
            if (updateLog) {
                executorId = updateLog.executor?.id ?? null;
                // timestamp = updateLog.createdAt; // Audit Log 시간 사용 가능
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

        // 데이터베이스에 저장할 JSON 데이터 (변경 전/후 정보 포함)
        const dataToStore = {
            channelId: channelId,
            channelName: newData.channelName, // 현재 이름
            channelType: newData.channelType, // 현재 타입
            changes: changes, // 변경된 속성만 기록
            executorUserId: executorId,
            // oldData: oldData, // 필요시 전체 이전 데이터 저장
            // newData: newData, // 필요시 전체 현재 데이터 저장
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId, // user_id: 채널 업데이트 실행자
                channelId, // channel_id: 이벤트가 발생한 채널 ID
                channelId, // target_id: 업데이트된 채널 ID
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for channel ${channelId} (${String(newData.channelName)}) in guild ${guildId}`,
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

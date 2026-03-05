import { Events, GuildMember, PartialGuildMember, User, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEventIfAuthorized as logEvent, shouldLogForGuild } from '../utils/eventLog.js';

const event = {
    name: Events.GuildMemberRemove,
    async execute(member: GuildMember | PartialGuildMember) {
        const eventType = 'guildMemberRemove';
        const guildId = member.guild.id;
        // PartialGuildMember일 경우 user 정보가 없을 수 있음
        const targetUser: User | null = member.user ?? null;
        const targetId = member.id; // member.id는 항상 사용 가능
        const timestamp = new Date();

        if (!shouldLogForGuild(guildId, eventType)) {
            return;
        }

        let action: 'leave' | 'kick' | 'ban' = 'leave'; // 기본값: 자발적 퇴장
        let executorId: string | null = null;
        let reason: string | null = null;

        // 사용자 정보가 있어야 Audit Log를 제대로 조회 가능
        if (targetUser) {
            try {
                // 최근 5개의 추방 및 밴 로그 조회
                const fetchedLogs = await member.guild.fetchAuditLogs({
                    limit: 5,
                    // type: [20, 22] // discord.js v14.7+ 에서 배열 지원, 이전 버전은 개별 조회 필요
                    // type: AuditLogEvent.MemberKick 또는 AuditLogEvent.MemberBanAdd
                });

                // 먼저 Kick 로그 확인 (type 20)
                const kickLog = fetchedLogs.entries.find(
                    (entry) =>
                        entry.action === AuditLogEvent.MemberKick && // MemberKick
                        entry.target instanceof User && // 대상이 User 타입인지 확인
                        entry.target.id === targetId &&
                        // 로그 생성 시간이 멤버 제거 시간과 너무 차이나지 않는지 확인 (선택적)
                        Math.abs(Date.now() - entry.createdTimestamp) < 5000, // 5초 이내
                );

                if (kickLog) {
                    action = 'kick';
                    executorId = kickLog.executor?.id ?? null;
                    reason = kickLog.reason ?? null;
                    // timestamp = kickLog.createdAt; // 로그 시간 사용 가능
                } else {
                    // Kick 로그가 없으면 Ban 로그 확인 (type 22)
                    // Ban은 guildBanAdd에서도 처리되지만, 여기서 확인하면 더 명확
                    const banLog = fetchedLogs.entries.find(
                        (entry) =>
                            entry.action === AuditLogEvent.MemberBanAdd && // MemberBanAdd
                            entry.target instanceof User && // 대상이 User 타입인지 확인
                            entry.target.id === targetId &&
                            Math.abs(Date.now() - entry.createdTimestamp) < 5000, // 5초 이내
                    );
                    if (banLog) {
                        action = 'ban';
                        executorId = banLog.executor?.id ?? null;
                        reason = banLog.reason ?? null;
                        // timestamp = banLog.createdAt;
                    }
                    // Kick도 Ban도 아니면 'leave' 유지
                }
            } catch (error) {
                logger.error(
                    `Failed to fetch Audit Logs for ${eventType} (user ${targetId}) in guild ${guildId}:`,
                    error,
                );
                // Audit Log 조회 실패 시 'leave'로 간주
            }
        }

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            targetUserId: targetId,
            targetUserTag: targetUser?.tag ?? 'Unknown User', // Partial일 경우 태그 없을 수 있음
            action: action,
            executorUserId: executorId,
            reason: reason,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId, // user_id: 실행자 (kick/ban의 경우), null이면 자발적 퇴장(leave) 추정
                null, // channel_id is null
                targetId, // target_id: 나간 사용자
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event (${action}) for user ${targetUser?.tag ?? targetId} in guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event for user ${targetId}:`,
                error,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export default event;

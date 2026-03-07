import { Events, AuditLogEvent } from 'discord.js';

import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { GuildBan, User } from 'discord.js';

const event = {
    name: Events.GuildBanAdd,
    async execute(ban: GuildBan) {
        const eventType = 'guildBanAdd';
        const guildId = ban.guild.id;
        const targetUser: User = ban.user; // 밴된 사용자 객체
        const targetId = targetUser.id;
        const timestamp = new Date();
        let executorId: string | null = null;
        let reason = ban.reason; // 밴 객체에 사유가 포함될 수 있음

        // Audit Log 조회 시도 (밴 실행자 및 상세 사유 확인)
        try {
            // Fetch a couple audit log entries for guild bans
            const fetchedLogs = await ban.guild.fetchAuditLogs({
                limit: 5, // 최근 5개 항목 확인 (시간차 고려)
                type: AuditLogEvent.MemberBanAdd,
            });
            // 밴된 사용자와 일치하는 가장 최근 로그 찾기
            const banLog = fetchedLogs.entries.find((entry) => entry.target?.id === targetUser.id);

            if (banLog) {
                executorId = banLog.executor?.id ?? null;
                // Audit Log의 사유가 더 우선순위가 높거나 상세할 수 있음
                if (banLog.reason) {
                    reason = banLog.reason;
                }
                // timestamp = banLog.createdAt; // Audit Log 시간 사용 가능
            } else {
                logger.warn(
                    `Could not find matching Audit Log entry for ban of ${targetUser.tag} (${targetId}) in guild ${guildId}. Executor info might be missing.`,
                );
            }
        } catch (error) {
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
            // Audit Log 조회 실패 시에도 기본적인 정보는 로깅 시도
        }

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            targetUserId: targetId,
            targetUserTag: targetUser.tag,
            executorUserId: executorId, // Audit Log에서 가져온 실행자 ID
            reason: reason, // 밴 사유
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId, // user_id: 밴 실행자
                null, // channel_id is null
                targetId, // target_id: 밴된 사용자
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for user ${targetUser.tag} (${targetId}) in guild ${guildId}`,
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
export { event };

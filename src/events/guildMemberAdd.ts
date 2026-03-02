import { Events, GuildMember } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent, isGuildAuthorized } from '../db/database.js';

const event = {
    name: Events.GuildMemberAdd,
    async execute(member: GuildMember) {
        const eventType = 'guildMemberAdd';
        const guildId = member.guild.id;
        const targetUser = member.user;
        const targetId = targetUser.id;
        const timestamp = member.joinedAt ?? new Date(); // 멤버 참가 시간 사용

        if (!guildId || !isGuildAuthorized(guildId)) {
            logger.warn(`Unauthorized ${eventType} event logging on guild ${guildId} skipped`);
            return;
        }

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            targetUserId: targetId,
            targetUserTag: targetUser.tag,
            accountCreatedAt: targetUser.createdAt.toISOString(), // 계정 생성일
            isBot: targetUser.bot,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                null, // user_id: 실행자 없음
                null, // channel_id: 특정 채널 없음
                targetId, // target_id: 참가한 사용자
                dataToStore,
                timestamp, // 멤버 참가 시간
            );
            logger.debug(
                `Logged ${eventType} event for user ${targetUser.tag} (${targetId}) joining guild ${guildId}`,
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

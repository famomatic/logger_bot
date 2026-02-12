import { Events, GuildBan, User, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

const event = {
  name: Events.GuildBanRemove,
  async execute(ban: GuildBan) {
    const eventType = 'guildBanRemove';
    const guildId = ban.guild.id;
    const targetUser: User = ban.user; // 밴 해제된 사용자
    const targetId = targetUser.id;
    const timestamp = new Date();
    let executorId: string | null = null;
    let reason: string | null = null; // 밴 해제는 보통 사유가 Audit Log에만 있음

    // Audit Log 조회 시도 (밴 해제 실행자 확인)
    try {
        const fetchedLogs = await ban.guild.fetchAuditLogs({
            limit: 5,
            type: AuditLogEvent.MemberBanRemove,
        });
        const unbanLog = fetchedLogs.entries.find(entry => entry.target?.id === targetUser.id);

        if (unbanLog) {
            executorId = unbanLog.executor?.id ?? null;
            reason = unbanLog.reason ?? null; // 밴 해제 사유 (있을 경우)
            // timestamp = unbanLog.createdAt;
        } else {
            logger.warn(`Could not find matching Audit Log entry for unban of ${targetUser.tag} (${targetId}) in guild ${guildId}. Executor info might be missing.`);
        }
    } catch (error) {
        logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
    }

    // 데이터베이스에 저장할 JSON 데이터
    const dataToStore = {
      targetUserId: targetId,
      targetUserTag: targetUser.tag,
      executorUserId: executorId,
      reason: reason, // 밴 해제 사유 (Audit Log에서)
    };

    try {
      await logEvent(
        eventType,
        guildId,
        executorId, // user_id: 밴 해제 실행자
        null,       // channel_id is null
        targetId,   // target_id: 밴 해제된 사용자
        dataToStore,
        timestamp
      );
      logger.debug(`Logged ${eventType} event for user ${targetUser.tag} (${targetId}) in guild ${guildId}`);
    } catch (error) {
      logger.error(`Error occurred while trying to log ${eventType} event for user ${targetId}:`, error);
    }
  },
} as const;

export default event; 
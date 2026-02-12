import { Events, Role, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent, isGuildAuthorized } from '../db/database.js';

const event = {
  name: Events.GuildRoleCreate,
  async execute(role: Role) {
    const eventType = 'roleCreate';
    const guildId = role.guild.id;
    const targetId = role.id; // 생성된 역할 ID
    const timestamp = role.createdAt ?? new Date();
    let executorId: string | null = null;

    if (!guildId || !isGuildAuthorized(guildId)) {
      logger.warn(`Unauthorized ${eventType} event logging on guild ${guildId} skipped`);
      return;
    };

    try {
        const fetchedLogs = await role.guild.fetchAuditLogs({
            limit: 1, // 역할 생성은 보통 단일 로그
            type: AuditLogEvent.RoleCreate, // 30
        });
        // 가장 최근 RoleCreate 로그 확인 (대상이 생성된 역할 ID와 일치하는지)
        const createLog = fetchedLogs.entries.first();
        // Audit Log의 target이 생성된 역할과 일치하는지 확인
        if (createLog && createLog.target?.id === targetId && Math.abs(Date.now() - createLog.createdTimestamp) < 5000) {
            executorId = createLog.executor?.id ?? null;
        } else {
            logger.warn(`Could not confirm executor for ${eventType} (role ${targetId}) in guild ${guildId} via Audit Log.`);
        }
    } catch (error) {
        logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
    }

    // 데이터베이스에 저장할 JSON 데이터
    const dataToStore = {
      roleId: targetId,
      roleName: role.name,
      roleColor: role.hexColor,
      permissions: role.permissions.bitfield.toString(), // 권한 비트 필드
      hoisted: role.hoist,
      mentionable: role.mentionable,
      position: role.position,
      executorUserId: executorId,
    };

    try {
      await logEvent(
        eventType,
        guildId,
        executorId, // user_id: 역할 생성 실행자
        null,       // channel_id is null for role events
        targetId,   // target_id: 생성된 역할 ID
        dataToStore,
        timestamp   // Use role.createdAt if available
      );
      logger.debug(`Logged ${eventType} event for role ${role.name} (${targetId}) in guild ${guildId}`);
    } catch (error) {
      logger.error(`Error occurred while trying to log ${eventType} event for role ${targetId}:`, error);
    }
  },
} as const;

export default event; 
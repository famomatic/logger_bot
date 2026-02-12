import { Events, Role, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent, isGuildAuthorized } from '../db/database.js';

const event = {
    name: Events.GuildRoleDelete,
    async execute(role: Role) {
        const eventType = 'roleDelete';
        const guildId = role.guild.id;
        const targetId = role.id; // 삭제된 역할 ID
        const timestamp = new Date();
        let executorId: string | null = null;

        if (!guildId || !isGuildAuthorized(guildId)) {
            logger.warn(`Unauthorized ${eventType} event logging on guild ${guildId} skipped`);
            return;
        }

        // 역할 삭제 정보 (삭제 직전의 정보)
        const deletedRoleInfo = {
            id: role.id,
            name: role.name,
            color: role.hexColor,
            permissions: role.permissions.bitfield.toString(),
            hoisted: role.hoist,
            mentionable: role.mentionable,
            position: role.position,
        };

        try {
            const fetchedLogs = await role.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.RoleDelete, // 32
            });
            // 가장 최근 RoleDelete 로그 확인 (대상이 삭제된 역할 ID와 일치하는지)
            // 주의: target은 Role 객체가 아닐 수 있음 (AuditLogEntryTarget)
            const deleteLog = fetchedLogs.entries.first();
            // target이 어떤 타입인지 명확하지 않으므로, 여기서는 target.id 비교 대신
            // 로그 자체의 targetId 필드를 확인하는 것이 더 안전할 수 있으나,
            // discord.js 타입상 target이 Role일 것으로 예상하고 비교
            if (
                deleteLog &&
                deleteLog.target?.id === targetId &&
                Math.abs(Date.now() - deleteLog.createdTimestamp) < 5000
            ) {
                executorId = deleteLog.executor?.id ?? null;
                // timestamp = deleteLog.createdAt;
            } else {
                logger.warn(
                    `Could not confirm executor for ${eventType} (role ${targetId}) in guild ${guildId} via Audit Log.`,
                );
            }
        } catch (error) {
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
        }

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            deletedRole: deletedRoleInfo,
            executorUserId: executorId,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId, // user_id: 역할 삭제 실행자
                null, // channel_id is null for role events
                targetId, // target_id: 삭제된 역할 ID
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for role ${deletedRoleInfo.name} (${targetId}) in guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event for role ${targetId}:`,
                error,
            );
        }
    },
} as const;

export default event;

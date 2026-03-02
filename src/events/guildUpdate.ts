import { Events, Guild, AuditLogEvent, AuditLogChange } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

// 헬퍼 함수: 특정 키 변경에 대한 Audit Log 찾기
async function findGuildUpdateLog(
    guild: Guild,
    changeKey: string,
): Promise<{ executorId: string | null; logTimestamp: Date | null }> {
    try {
        const fetchedLogs = await guild.fetchAuditLogs({
            limit: 5,
            type: AuditLogEvent.GuildUpdate, // 1
        });
        const updateLog = fetchedLogs.entries.find(
            (entry) =>
                entry.changes?.some((c: AuditLogChange) => c.key === changeKey) &&
                Math.abs(Date.now() - entry.createdTimestamp) < 6000, // 시간차 6초로 약간 늘림
        );
        if (updateLog) {
            return {
                executorId: updateLog.executor?.id ?? null,
                logTimestamp: updateLog.createdAt,
            };
        }
    } catch (error) {
        logger.error(
            `Failed to fetch Audit Logs for GuildUpdate (${changeKey}) in guild ${guild.id}:`,
            error,
        );
    }
    return { executorId: null, logTimestamp: null };
}

// 헬퍼 함수: 로그 기록 (수정됨)
async function logGuildUpdate(
    eventType: string,
    guildId: string,
    userId: string | null,
    targetId: string,
    timestamp: Date,
    data: Record<string, unknown>,
) {
    try {
        await logEvent(
            eventType,
            guildId,
            userId, // executorId from Audit Log
            null, // channel_id is null for guild updates
            targetId, // target_id is the guildId itself
            data,
            timestamp,
        );
        logger.debug(`Logged ${eventType} event for guild ${guildId}`);
    } catch (error) {
        logger.error(
            `Error occurred while trying to log ${eventType} event for guild ${guildId}:`,
            error,
        );
    }
}

const event = {
    name: Events.GuildUpdate,
    async execute(oldGuild: Guild, newGuild: Guild) {
        const guildId = newGuild.id;
        const baseTimestamp = new Date(); // 기본 타임스탬프

        // --- 서버 이름 변경 감지 ---
        if (oldGuild.name !== newGuild.name) {
            const { executorId, logTimestamp } = await findGuildUpdateLog(newGuild, 'name');
            const dataToStore = {
                oldName: oldGuild.name,
                newName: newGuild.name,
                executorUserId: executorId,
            };
            await logGuildUpdate(
                'guildNameUpdate',
                guildId,
                executorId,
                guildId,
                logTimestamp ?? baseTimestamp,
                dataToStore,
            );
        }

        // --- 서버 아이콘 변경 감지 ---
        if (oldGuild.icon !== newGuild.icon) {
            const { executorId, logTimestamp } = await findGuildUpdateLog(newGuild, 'icon_hash'); // Audit Log key: icon_hash
            const dataToStore = {
                oldIconURL: oldGuild.iconURL(),
                newIconURL: newGuild.iconURL(),
                executorUserId: executorId,
            };
            await logGuildUpdate(
                'guildIconUpdate',
                guildId,
                executorId,
                guildId,
                logTimestamp ?? baseTimestamp,
                dataToStore,
            );
        }

        // --- 서버 소유자 변경 감지 ---
        if (oldGuild.ownerId !== newGuild.ownerId) {
            const { executorId, logTimestamp } = await findGuildUpdateLog(newGuild, 'owner_id'); // Audit Log key: owner_id
            let oldOwnerTag: string | null = null;
            let newOwnerTag: string | null = null;
            try {
                const oldOwner = await oldGuild.client.users
                    .fetch(oldGuild.ownerId)
                    .catch(() => null);
                oldOwnerTag = oldOwner?.tag ?? 'Unknown User';
                const newOwner = await newGuild.client.users
                    .fetch(newGuild.ownerId)
                    .catch(() => null);
                newOwnerTag = newOwner?.tag ?? 'Unknown User';
            } catch (fetchError) {
                logger.error(`Failed to fetch owner details for guild ${guildId}:`, fetchError);
            }

            const dataToStore = {
                oldOwnerId: oldGuild.ownerId,
                oldOwnerTag: oldOwnerTag,
                newOwnerId: newGuild.ownerId,
                newOwnerTag: newOwnerTag,
                executorUserId: executorId,
            };
            await logGuildUpdate(
                'guildOwnerUpdate',
                guildId,
                executorId,
                guildId,
                logTimestamp ?? baseTimestamp,
                dataToStore,
            );
        }

        // --- 다른 길드 변경 사항 감지 로직 추가 가능 ---
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export default event;

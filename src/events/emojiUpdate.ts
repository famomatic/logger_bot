import { Events, GuildEmoji, AuditLogEvent, AuditLogChange } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';

const event = {
    name: Events.GuildEmojiUpdate,
    async execute(oldEmoji: GuildEmoji, newEmoji: GuildEmoji) {
        // 이름 외 다른 변경(예: required_roles)은 현재 무시하거나 별도 처리 필요
        if (oldEmoji.name === newEmoji.name) {
            return; // 이름 변경이 없으면 종료
        }

        const eventType = 'emojiUpdate';
        const guild = newEmoji.guild;
        const guildId = guild.id;
        const targetId = newEmoji.id; // 변경된 이모지 ID
        const timestamp = new Date();
        let executorId: string | null = null;

        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.EmojiUpdate, // 61
            });
            // 가장 최근 EmojiUpdate 로그 확인 (대상이 변경된 이모지 ID이고, name 변경이 있는지)
            const updateLog = fetchedLogs.entries.find(
                (entry) =>
                    entry.target?.id === targetId &&
                    entry.changes?.some((c: AuditLogChange) => c.key === 'name') &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );
            if (updateLog) {
                executorId = updateLog.executor?.id ?? null;
            } else {
                logger.warn(
                    `Could not confirm executor for ${eventType} (emoji ${targetId}) in guild ${guildId} via Audit Log.`,
                );
            }
        } catch (error) {
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
        }

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            emojiId: targetId,
            oldName: oldEmoji.name,
            newName: newEmoji.name,
            emojiIdentifier: newEmoji.identifier,
            emojiUrl: newEmoji.url,
            executorUserId: executorId,
        };

        try {
            await logEvent(eventType, guildId, executorId, null, targetId, dataToStore, timestamp);
            logger.debug(
                `Logged ${eventType} event for emoji ${newEmoji.name} (${targetId}) in guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event for emoji ${targetId}:`,
                error,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export default event;

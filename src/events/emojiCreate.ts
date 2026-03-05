import { Events, GuildEmoji, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';

const event = {
    name: Events.GuildEmojiCreate,
    async execute(emoji: GuildEmoji) {
        const eventType = 'emojiCreate';
        const guild = emoji.guild;
        const guildId = guild.id;
        const targetId = emoji.id; // 생성된 이모지 ID
        const timestamp = emoji.createdTimestamp ? new Date(emoji.createdTimestamp) : new Date();
        let executorId: string | null = null;

        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.EmojiCreate, // 60
            });
            // 가장 최근 EmojiCreate 로그 확인 (대상이 생성된 이모지 ID와 일치하는지)
            const createLog = fetchedLogs.entries.first();
            // Audit Log의 target이 생성된 이모지와 일치하는지 확인
            if (
                createLog &&
                createLog.target?.id === targetId &&
                Math.abs(Date.now() - createLog.createdTimestamp) < 5000
            ) {
                executorId = createLog.executor?.id ?? null;
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
            emojiName: emoji.name,
            emojiIdentifier: emoji.identifier, // <name:id> 또는 <a:name:id>
            emojiUrl: emoji.imageURL(),
            animated: emoji.animated,
            available: emoji.available,
            executorUserId: executorId,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId,
                null, // channel_id is null for this event
                targetId, // target_id: 생성된 이모지
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for emoji ${emoji.name} (${targetId}) in guild ${guildId}`,
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

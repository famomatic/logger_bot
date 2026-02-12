import { Events, GuildEmoji, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

const event = {
  name: Events.GuildEmojiDelete,
  async execute(emoji: GuildEmoji) {
    const eventType = 'emojiDelete';
    const guild = emoji.guild;
    const guildId = guild.id;
    const targetId = emoji.id; // 삭제된 이모지 ID
    const timestamp = new Date();
    let executorId: string | null = null;

    // 삭제된 이모지 정보 (삭제 직전)
    const deletedEmojiInfo = {
        id: emoji.id,
        name: emoji.name,
        identifier: emoji.identifier,
        url: emoji.imageURL(),
        animated: emoji.animated,
    };

    try {
        const fetchedLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.EmojiDelete, // 62
        });
        // 가장 최근 EmojiDelete 로그 확인 (대상이 삭제된 이모지 ID와 일치하는지)
        const deleteLog = fetchedLogs.entries.first();
        if (deleteLog && deleteLog.target?.id === targetId && Math.abs(Date.now() - deleteLog.createdTimestamp) < 5000) {
            executorId = deleteLog.executor?.id ?? null;
        } else {
            logger.warn(`Could not confirm executor for ${eventType} (emoji ${targetId}) in guild ${guildId} via Audit Log.`);
        }
    } catch (error) {
        logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
    }

    // 데이터베이스에 저장할 JSON 데이터
    const dataToStore = {
      deletedEmoji: deletedEmojiInfo,
      executorUserId: executorId,
    };

    try {
      await logEvent(
        eventType,
        guildId,
        executorId,
        null, // channel_id is null for this event
        targetId, // target_id: 삭제된 이모지
        dataToStore,
        timestamp
      );
      logger.debug(`Logged ${eventType} event for emoji ${deletedEmojiInfo.name} (${targetId}) in guild ${guildId}`);
    } catch (error) {
      logger.error(`Error occurred while trying to log ${eventType} event for emoji ${targetId}:`, error);
    }
  },
} as const;

export default event; 
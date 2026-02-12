import { Events, Sticker, StickerFormatType, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

// StickerFormatType enum을 문자열로 변환하는 헬퍼
function getStickerFormatName(formatType: StickerFormatType): string {
    switch (formatType) {
        case StickerFormatType.PNG: return 'PNG';
        case StickerFormatType.APNG: return 'APNG';
        case StickerFormatType.Lottie: return 'Lottie';
        default: return 'Unknown';
    }
}

const event = {
  name: Events.GuildStickerCreate,
  async execute(sticker: Sticker) {
    // Guild 정보가 없으면 처리 불가 (이론상 서버 스티커이므로 항상 있음)
    if (!sticker.guild) return;

    const eventType = 'stickerCreate';
    const guild = sticker.guild;
    const guildId = guild.id;
    const targetId = sticker.id; // 생성된 스티커 ID
    const timestamp = sticker.createdTimestamp ? new Date(sticker.createdTimestamp) : new Date();
    let executorId: string | null = null;

    try {
        const fetchedLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.StickerCreate, // 90
        });
        const createLog = fetchedLogs.entries.first();
        if (createLog && createLog.target?.id === targetId && Math.abs(Date.now() - createLog.createdTimestamp) < 5000) {
            executorId = createLog.executor?.id ?? null;
        } else {
            logger.warn(`Could not confirm executor for ${eventType} (sticker ${targetId}) in guild ${guildId} via Audit Log.`);
        }
    } catch (error) {
        logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
    }

    const dataToStore = {
      stickerId: targetId,
      stickerName: sticker.name,
      stickerTags: sticker.tags,
      stickerDescription: sticker.description,
      stickerFormat: getStickerFormatName(sticker.format),
      stickerUrl: sticker.url,
      available: sticker.available,
      guildId: sticker.guildId, // 확인차 포함
      executorUserId: executorId,
    };

    try {
      await logEvent(
        eventType,
        guildId,
        executorId,
        null, // channel_id is null for this event
        targetId, // target_id: 생성된 스티커
        dataToStore,
        timestamp
      );
      logger.debug(`Logged ${eventType} event for sticker ${sticker.name} (${targetId}) in guild ${guildId}`);
    } catch (error) {
      logger.error(`Error occurred while trying to log ${eventType} event for sticker ${targetId}:`, error);
    }
  },
} as const;

export default event; 
import { Events, Sticker, StickerFormatType, AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

// StickerFormatType enum을 문자열로 변환하는 헬퍼 (stickerCreate와 동일)
function getStickerFormatName(formatType: StickerFormatType): string {
    switch (formatType) {
        case StickerFormatType.PNG:
            return 'PNG';
        case StickerFormatType.APNG:
            return 'APNG';
        case StickerFormatType.Lottie:
            return 'Lottie';
        default:
            return 'Unknown';
    }
}

const event = {
    name: Events.GuildStickerDelete,
    async execute(sticker: Sticker) {
        if (!sticker.guild) return;

        const eventType = 'stickerDelete';
        const guild = sticker.guild;
        const guildId = guild.id;
        const targetId = sticker.id; // 삭제된 스티커 ID
        const timestamp = new Date();
        let executorId: string | null = null;

        // 삭제된 스티커 정보 (삭제 직전)
        const deletedStickerInfo = {
            id: sticker.id,
            name: sticker.name,
            tags: sticker.tags,
            description: sticker.description,
            format: getStickerFormatName(sticker.format),
            url: sticker.url,
        };

        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.StickerDelete, // 92
            });
            const deleteLog = fetchedLogs.entries.first();
            if (
                deleteLog &&
                deleteLog.target?.id === targetId &&
                Math.abs(Date.now() - deleteLog.createdTimestamp) < 5000
            ) {
                executorId = deleteLog.executor?.id ?? null;
            } else {
                logger.warn(
                    `Could not confirm executor for ${eventType} (sticker ${targetId}) in guild ${guildId} via Audit Log.`,
                );
            }
        } catch (error) {
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
        }

        const dataToStore = {
            deletedSticker: deletedStickerInfo,
            executorUserId: executorId,
        };

        try {
            await logEvent(eventType, guildId, executorId, null, targetId, dataToStore, timestamp);
            logger.debug(
                `Logged ${eventType} event for sticker ${deletedStickerInfo.name} (${targetId}) in guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event for sticker ${targetId}:`,
                error,
            );
        }
    },
} as const;

export default event;

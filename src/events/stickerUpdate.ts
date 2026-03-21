import { Events, AuditLogEvent } from 'discord.js';

import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { Sticker, AuditLogChange } from 'discord.js';

// 변경된 내용을 사람이 읽기 쉬운 형태로 변환하는 헬퍼 함수 (roleUpdate와 유사)
function formatStickerChange(change: AuditLogChange): string {
    const keyMap: Record<string, string> = {
        name: '이름',
        description: '설명',
        tags: '태그',
        // asset: '파일' (변경 감지 어려움), available: '사용 가능 여부' 등
    };
    const keyName = keyMap[change.key] ?? change.key;
    const oldStr =
        typeof change.old === 'object' ? JSON.stringify(change.old) : String(change.old ?? '');
    const newStr =
        typeof change.new === 'object' ? JSON.stringify(change.new) : String(change.new ?? '');
    return `${keyName}: '${oldStr}' -> '${newStr}'`;
}

const event = {
    name: Events.GuildStickerUpdate,
    async execute(oldSticker: Sticker, newSticker: Sticker) {
        // 변경 사항 직접 비교 (Audit Log 전에 기본 확인)
        if (
            oldSticker.name === newSticker.name &&
            oldSticker.description === newSticker.description &&
            oldSticker.tags === newSticker.tags
        ) {
            return; // 주요 속성 변경 없으면 종료
        }
        if (!newSticker.guild) return; // 길드 정보 없으면 종료

        const eventType = 'stickerUpdate';
        const guild = newSticker.guild;
        const guildId = guild.id;
        const targetId = newSticker.id; // 변경된 스티커 ID
        const timestamp = new Date();
        let executorId: string | null;
        let changesDescription: string;

        // Audit Log 조회 시도
        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 5,
                type: AuditLogEvent.StickerUpdate, // 91
            });
            const updateLog = fetchedLogs.entries.find(
                (entry) =>
                    entry.target.id === targetId &&
                    Math.abs(Date.now() - entry.createdTimestamp) < 5000,
            );

            if (updateLog) {
                executorId = updateLog.executor?.id ?? null;
                changesDescription = updateLog.changes.map(formatStickerChange).join('\n');
                if (!changesDescription) {
                    changesDescription = '변경 내역을 Audit Log에서 찾을 수 없음';
                }
            } else {
                executorId = null;
                logger.warn(
                    `Could not find exact Audit Log entry for ${eventType} (sticker ${targetId}) in guild ${guildId}. Executor and precise changes might be missing.`,
                );
                // Audit Log 못 찾으면 직접 비교 결과 사용
                const detectedChanges: string[] = [];
                if (oldSticker.name !== newSticker.name)
                    detectedChanges.push(`이름: '${oldSticker.name}' -> '${newSticker.name}'`);
                if (oldSticker.description !== newSticker.description)
                    detectedChanges.push(
                        `설명: '${String(oldSticker.description ?? '')}' -> '${String(newSticker.description ?? '')}'`,
                    );
                if (oldSticker.tags !== newSticker.tags)
                    detectedChanges.push(
                        `태그: '${String(oldSticker.tags ?? '')}' -> '${String(newSticker.tags ?? '')}'`,
                    );
                changesDescription = detectedChanges.join('\n');
            }
        } catch (error) {
            executorId = null;
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
            // 에러 시 직접 비교 결과 사용
            const detectedChanges: string[] = [];
            if (oldSticker.name !== newSticker.name)
                detectedChanges.push(`이름: '${oldSticker.name}' -> '${newSticker.name}'`);
            if (oldSticker.description !== newSticker.description)
                detectedChanges.push(
                    `설명: '${String(oldSticker.description ?? '')}' -> '${String(newSticker.description ?? '')}'`,
                );
            if (oldSticker.tags !== newSticker.tags)
                detectedChanges.push(
                    `태그: '${String(oldSticker.tags ?? '')}' -> '${String(newSticker.tags ?? '')}'`,
                );
            changesDescription = detectedChanges.join('\n');
        }

        // 위에서 return되지 않았다면 변경사항이 있는 것
        const dataToStore = {
            stickerId: targetId,
            stickerName: newSticker.name,
            changes: changesDescription,
            executorUserId: executorId,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                executorId,
                null, // channel_id is null for this event
                targetId, // target_id: 변경된 스티커 ID
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for sticker ${newSticker.name} (${targetId}) in guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event for sticker ${targetId}:`,
                error,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export { event };

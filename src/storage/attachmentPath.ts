import { sanitizeFilename } from '../utils/sanitize.js';

/**
 * 첨부파일 저장 시 사용하는 표준 상대 경로를 생성합니다.
 */
export function createAttachmentStoragePath(
    guildId: string,
    channelId: string,
    messageId: string,
    attachmentId: string,
    attachmentName?: string | null,
): string {
    const safeName = sanitizeFilename(attachmentName ?? 'file');
    return `${guildId}/${channelId}/${messageId}/${attachmentId}_${safeName}`;
}

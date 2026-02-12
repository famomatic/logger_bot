import { sanitizeFilename } from '../utils/sanitize.js';

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

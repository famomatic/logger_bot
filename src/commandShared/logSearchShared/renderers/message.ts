import type { JsonValue } from '../../../types/json.js';
import { escapeCodeBlockContent } from '../../../utils/sanitize.js';
import { formatStickerSummary, str } from '../formatters.js';
import { isJsonData } from '../types.js';

interface RenderMessageEventParams {
    eventType: string;
    eventData: JsonValue | undefined;
}

export function renderEvent({ eventType, eventData }: RenderMessageEventParams): string {
    if (!isJsonData(eventData)) {
        return '(내용 없음)';
    }

    switch (eventType) {
        case 'messageCreate':
        case 'messageDelete': {
            const messageParts: string[] = [];
            const content = typeof eventData.content === 'string' ? eventData.content : '';
            if (content.trim().length > 0) {
                messageParts.push(`\`\`\`${escapeCodeBlockContent(content)}\`\`\``);
            }

            const stickers = Array.isArray(eventData.stickers) ? eventData.stickers : [];
            if (stickers.length > 0) {
                const stickerSummaries = stickers.map((sticker, index: number) =>
                    formatStickerSummary(sticker, index),
                );
                messageParts.push(`스티커:\n${stickerSummaries.join('\n')}`);
            }

            return messageParts.length > 0 ? messageParts.join('\n\n') : '(내용 없음)';
        }
        case 'messageUpdate': {
            const oldContent = str(eventData.oldContent);
            const newContent = str(eventData.newContent);
            if (newContent && oldContent) {
                const oldContentPreview =
                    oldContent.length > 100 ? `${oldContent.substring(0, 100)}...` : oldContent;
                return `현재: \`\`\`${escapeCodeBlockContent(newContent)}\`\`\`\n이전: \`\`\`${escapeCodeBlockContent(oldContentPreview)}\`\`\``;
            }
            if (newContent) {
                return `\`\`\`${escapeCodeBlockContent(newContent)}\`\`\``;
            }
            if (oldContent) {
                return `이전: \`\`\`${escapeCodeBlockContent(oldContent)}\`\`\``;
            }
            return '(내용 없음)';
        }
        default:
            return '(내용 없음)';
    }
}

import type { JsonValue } from '../../../types/json.js';
import { escapeCodeBlockContent } from '../../../utils/sanitize.js';
import { formatStickerSummary, str } from '../formatters.js';
import { isJsonData } from '../types.js';

interface RenderMessageEventParams {
    eventType: string;
    eventData: JsonValue | undefined;
}

const COMPONENT_TYPE_LABELS: Record<number, string> = {
    1: 'ActionRow',
    2: 'Button',
    3: 'StringSelect',
    4: 'TextInput',
    5: 'UserSelect',
    6: 'RoleSelect',
    7: 'MentionableSelect',
    8: 'ChannelSelect',
    9: 'Section',
    10: 'TextDisplay',
    11: 'Thumbnail',
    12: 'MediaGallery',
    13: 'File',
    14: 'Separator',
    17: 'Container',
    18: 'Label',
    19: 'FileUpload',
};

function summarizeComponentTypes(components: JsonValue[] | undefined): string | null {
    if (!components || components.length === 0) {
        return null;
    }

    const counts = new Map<string, number>();
    for (const component of components) {
        if (!isJsonData(component)) {
            continue;
        }
        const typeNumber =
            typeof component.type === 'number'
                ? component.type
                : typeof component.type === 'string'
                  ? Number(component.type)
                  : Number.NaN;
        const typeName = Number.isNaN(typeNumber)
            ? 'Unknown'
            : (COMPONENT_TYPE_LABELS[typeNumber] ?? `Type${typeNumber}`);
        counts.set(typeName, (counts.get(typeName) ?? 0) + 1);
    }

    if (counts.size === 0) {
        return null;
    }

    return Array.from(counts.entries())
        .map(([name, count]) => `${name} x${count}`)
        .join(', ');
}

function buildMessageFlagSummary(flagsValue: JsonValue | undefined): string | null {
    if (!isJsonData(flagsValue)) {
        return null;
    }

    const isComponentsV2 = flagsValue.isComponentsV2 === true ? 'Y' : 'N';
    const hasSnapshot = flagsValue.hasSnapshot === true ? 'Y' : 'N';
    const bitfield = str(flagsValue.bitfield, '');

    if (!bitfield) {
        return `플래그: ComponentsV2=${isComponentsV2}, HasSnapshot=${hasSnapshot}`;
    }

    return `플래그: ComponentsV2=${isComponentsV2}, HasSnapshot=${hasSnapshot}, Bitfield=${bitfield}`;
}

function buildForwardSummary(forwarded: JsonValue[] | undefined): string | null {
    if (!forwarded || forwarded.length === 0) {
        return null;
    }

    const lines: string[] = [`전달 메시지: ${forwarded.length}개`];
    const maxPreviewCount = 3;
    const visible = forwarded.slice(0, maxPreviewCount);

    visible.forEach((item, index) => {
        if (!isJsonData(item)) {
            lines.push(`${index + 1}. (파싱 불가)`);
            return;
        }

        const author = isJsonData(item.author) ? item.author : null;
        const authorLabel = str(author?.tag ?? author?.username, '알 수 없음');
        const content = str(item.content, '').trim();
        const contentPreview =
            content.length > 60 ? `${content.substring(0, 60)}...` : content || '(본문 없음)';
        const attachments = Array.isArray(item.attachments) ? item.attachments.length : 0;
        const embeds = Array.isArray(item.embeds) ? item.embeds.length : 0;
        const componentSummary = summarizeComponentTypes(
            Array.isArray(item.components) ? item.components : undefined,
        );
        const flagSummary = buildMessageFlagSummary(item.flags);

        const details: string[] = [
            `작성자: ${authorLabel}`,
            `본문: ${contentPreview}`,
            `첨부 ${attachments}개`,
            `임베드 ${embeds}개`,
        ];
        if (componentSummary) {
            details.push(`컴포넌트 ${componentSummary}`);
        }
        if (flagSummary) {
            details.push(flagSummary.replace('플래그: ', ''));
        }

        lines.push(`${index + 1}. ${details.join(' | ')}`);
    });

    if (forwarded.length > maxPreviewCount) {
        lines.push(`...외 ${forwarded.length - maxPreviewCount}개`);
    }

    return lines.join('\n');
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

            const flagsSummary = buildMessageFlagSummary(eventData.messageFlags);
            if (flagsSummary) {
                messageParts.push(flagsSummary);
            }

            const componentSummary = summarizeComponentTypes(
                Array.isArray(eventData.components) ? eventData.components : undefined,
            );
            if (componentSummary) {
                const componentCount = Array.isArray(eventData.components)
                    ? eventData.components.length
                    : 0;
                messageParts.push(`컴포넌트: ${componentCount}개 (${componentSummary})`);
            }

            const forwardedSummary = buildForwardSummary(
                Array.isArray(eventData.forwardedContentList)
                    ? eventData.forwardedContentList
                    : undefined,
            );
            if (forwardedSummary) {
                messageParts.push(forwardedSummary);
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

import { t, escapeCodeBlockContent } from '../deps.js';
import { formatStickerSummary, str } from '../formatters.js';
import { isJsonData } from '../types.js';

import type { SupportedLocale, JsonValue } from '../deps.js';

interface RenderMessageEventParams {
    eventType: string;
    eventData: JsonValue | undefined;
    locale: SupportedLocale;
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

/**
 * 메시지 컴포넌트 배열을 타입별 개수 요약 문자열로 변환합니다.
 */
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

/**
 * 메시지 플래그 객체를 사람이 읽기 쉬운 요약으로 변환합니다.
 */
function buildMessageFlagSummary(
    locale: SupportedLocale,
    flagsValue: JsonValue | undefined,
): string | null {
    if (!isJsonData(flagsValue)) {
        return null;
    }

    const isComponentsV2 = flagsValue.isComponentsV2 === true ? 'Y' : 'N';
    const hasSnapshot = flagsValue.hasSnapshot === true ? 'Y' : 'N';
    const bitfield = str(flagsValue.bitfield, '');

    if (!bitfield) {
        return t(locale, 'logSearchShared.message.flagsNoBitfield', {
            isComponentsV2,
            hasSnapshot,
        });
    }

    return t(locale, 'logSearchShared.message.flagsWithBitfield', {
        isComponentsV2,
        hasSnapshot,
        bitfield,
    });
}

/**
 * 전달 메시지 목록을 미리보기 텍스트로 요약합니다.
 */
function buildForwardSummary(
    locale: SupportedLocale,
    forwarded: JsonValue[] | undefined,
): string | null {
    if (!forwarded || forwarded.length === 0) {
        return null;
    }

    const lines: string[] = [
        t(locale, 'logSearchShared.message.forwardedCount', { count: forwarded.length }),
    ];
    const maxPreviewCount = 3;
    const visible = forwarded.slice(0, maxPreviewCount);

    visible.forEach((item, index) => {
        if (!isJsonData(item)) {
            lines.push(
                t(locale, 'logSearchShared.message.forwardedUnreadable', { index: index + 1 }),
            );
            return;
        }

        const author = isJsonData(item.author) ? item.author : null;
        const authorLabel = str(
            author?.tag ?? author?.username,
            t(locale, 'logSearchShared.legacy.unknown'),
        );
        const content = str(item.content, '').trim();
        const contentPreview =
            content.length > 60
                ? `${content.substring(0, 60)}...`
                : content || t(locale, 'logSearchShared.message.noBody');
        const attachments = Array.isArray(item.attachments) ? item.attachments.length : 0;
        const embeds = Array.isArray(item.embeds) ? item.embeds.length : 0;
        const componentSummary = summarizeComponentTypes(
            Array.isArray(item.components) ? item.components : undefined,
        );
        const flagSummary = buildMessageFlagSummary(locale, item.flags);

        const details: string[] = [
            t(locale, 'logSearchShared.message.author', { value: authorLabel }),
            t(locale, 'logSearchShared.message.body', { value: contentPreview }),
            t(locale, 'logSearchShared.message.attachmentsCount', { count: attachments }),
            t(locale, 'logSearchShared.message.embedsCount', { count: embeds }),
        ];
        if (componentSummary) {
            details.push(
                t(locale, 'logSearchShared.message.componentsSummary', { value: componentSummary }),
            );
        }
        if (flagSummary) {
            details.push(flagSummary);
        }

        lines.push(
            t(locale, 'logSearchShared.message.forwardedLine', {
                index: index + 1,
                value: details.join(' | '),
            }),
        );
    });

    if (forwarded.length > maxPreviewCount) {
        lines.push(
            t(locale, 'logSearchShared.message.forwardedRemaining', {
                count: forwarded.length - maxPreviewCount,
            }),
        );
    }

    return lines.join('\n');
}

/**
 * 메시지 이벤트 타입별 상세 본문 텍스트를 렌더링합니다.
 */
export function renderEvent({ eventType, eventData, locale }: RenderMessageEventParams): string {
    if (!isJsonData(eventData)) {
        return t(locale, 'logSearchShared.legacy.noContent');
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
                messageParts.push(
                    t(locale, 'logSearchShared.message.stickersBlock', {
                        value: stickerSummaries.join('\n'),
                    }),
                );
            }

            const flagsSummary = buildMessageFlagSummary(locale, eventData.messageFlags);
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
                messageParts.push(
                    t(locale, 'logSearchShared.message.componentsCount', {
                        count: componentCount,
                        value: componentSummary,
                    }),
                );
            }

            const forwardedSummary = buildForwardSummary(
                locale,
                Array.isArray(eventData.forwardedContentList)
                    ? eventData.forwardedContentList
                    : undefined,
            );
            if (forwardedSummary) {
                messageParts.push(forwardedSummary);
            }

            return messageParts.length > 0
                ? messageParts.join('\n\n')
                : t(locale, 'logSearchShared.legacy.noContent');
        }
        case 'messageUpdate': {
            const oldContent = str(eventData.oldContent);
            const newContent = str(eventData.newContent);
            if (newContent && oldContent) {
                const oldContentPreview =
                    oldContent.length > 100 ? `${oldContent.substring(0, 100)}...` : oldContent;
                return t(locale, 'logSearchShared.message.currentAndPrevious', {
                    current: `\`\`\`${escapeCodeBlockContent(newContent)}\`\`\``,
                    previous: `\`\`\`${escapeCodeBlockContent(oldContentPreview)}\`\`\``,
                });
            }
            if (newContent) {
                return `\`\`\`${escapeCodeBlockContent(newContent)}\`\`\``;
            }
            if (oldContent) {
                return t(locale, 'logSearchShared.message.previousOnly', {
                    previous: `\`\`\`${escapeCodeBlockContent(oldContent)}\`\`\``,
                });
            }
            return t(locale, 'logSearchShared.legacy.noContent');
        }
        default:
            return t(locale, 'logSearchShared.legacy.noContent');
    }
}

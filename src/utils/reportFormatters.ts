import type { Client } from 'discord.js';
import type {
    EventTypeCountLike,
    FormatListOptions,
    IdCountLike,
    MentionEntityType,
} from '../types/reportFormatters.js';

/**
 * 공통 순위 목록 렌더러입니다. 데이터가 없으면 빈 텍스트를 반환합니다.
 */
function formatRankedList<T>(
    items: T[],
    formatter: (item: T, index: number) => string,
    emptyText: string,
): string {
    if (items.length === 0) {
        return emptyText;
    }

    return items.map((item, index) => formatter(item, index)).join('\n');
}

/**
 * 숫자를 지정한 locale 규칙으로 포맷합니다.
 */
export function formatLocalizedNumber(value: number, locale = 'ko-KR'): string {
    return value.toLocaleString(locale);
}

/**
 * 이벤트 타입별 집계 배열을 순위 목록 문자열로 변환합니다.
 */
export function formatEventTypeCountList(
    eventTypes: EventTypeCountLike[],
    options: FormatListOptions = {},
): string {
    const { locale = 'en-US', emptyText = 'None', countUnit = '' } = options;

    return formatRankedList(
        eventTypes,
        (item, index) =>
            `${index + 1}. ${item.eventType} - ${formatLocalizedNumber(item.count, locale)}${countUnit}`,
        emptyText,
    );
}

/**
 * 채널/사용자 ID 기반 집계를 멘션 포함 순위 문자열로 변환합니다.
 */
export function formatEntityCountList(
    items: IdCountLike[],
    entity: MentionEntityType,
    options: FormatListOptions & { includeId?: boolean } = {},
): string {
    const { locale = 'en-US', emptyText = 'None', countUnit = '', includeId = true } = options;

    const mentionPrefix = entity === 'channel' ? '#' : '@';

    return formatRankedList(
        items,
        (item, index) => {
            const mentionText = `<${mentionPrefix}${item.id}>`;
            const idText = includeId ? ` (ID: \`${item.id}\`)` : '';
            return `${index + 1}. ${mentionText}${idText} - ${formatLocalizedNumber(item.count, locale)}${countUnit}`;
        },
        emptyText,
    );
}

/**
 * 사용자 ID 목록을 `tag (id)` 문자열 목록으로 변환합니다.
 */
export async function formatUserTagListFromIds(
    client: Client,
    ids: string[] | undefined,
    options: { emptyText?: string; unknownPrefix?: string } = {},
): Promise<string> {
    const { emptyText = 'None', unknownPrefix = 'ID' } = options;

    if (!ids || ids.length === 0) {
        return emptyText;
    }

    const formatted = await Promise.all(
        ids.map(async (id) => {
            const cached = client.users.cache.get(id);
            if (cached) {
                return `${cached.tag} (${id})`;
            }

            try {
                const fetched = await client.users.fetch(id);
                return `${fetched.tag} (${id})`;
            } catch {
                return `${unknownPrefix}: ${id}`;
            }
        }),
    );

    return formatted.join('\n');
}

import type { Client } from 'discord.js';

export interface EventTypeCountLike {
    eventType: string;
    count: number;
}

export interface IdCountLike {
    id: string;
    count: number;
}

export interface FormatListOptions {
    locale?: string;
    emptyText?: string;
    countUnit?: string;
}

export type MentionEntityType = 'user' | 'channel';

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

export function formatLocalizedNumber(value: number, locale = 'ko-KR'): string {
    return value.toLocaleString(locale);
}

export function formatEventTypeCountList(
    eventTypes: EventTypeCountLike[],
    options: FormatListOptions = {},
): string {
    const { locale = 'ko-KR', emptyText = '없음', countUnit = '건' } = options;

    return formatRankedList(
        eventTypes,
        (item, index) =>
            `${index + 1}. ${item.eventType} - ${formatLocalizedNumber(item.count, locale)}${countUnit}`,
        emptyText,
    );
}

export function formatEntityCountList(
    items: IdCountLike[],
    entity: MentionEntityType,
    options: FormatListOptions & { includeId?: boolean } = {},
): string {
    const { locale = 'ko-KR', emptyText = '없음', countUnit = '건', includeId = true } = options;

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

export async function formatUserTagListFromIds(
    client: Client,
    ids: string[] | undefined,
    options: { emptyText?: string; unknownPrefix?: string } = {},
): Promise<string> {
    const { emptyText = '없음', unknownPrefix = 'ID' } = options;

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

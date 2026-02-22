import type { JsonValue } from '../../types/json.js';
import { STICKER_FORMAT_LABELS } from './constants.js';
import { isJsonData } from './types.js';

/** Safely converts an unknown/JsonValue to a string. Returns fallback if nullish. */
export function str(val: JsonValue | undefined, fallback = ''): string {
    if (val == null) return fallback;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return JSON.stringify(val);
}

/** Safely converts a value to a number. Returns fallback if not a valid number. */
export function num(val: JsonValue | undefined, fallback = 0): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const parsed = Number(val);
        return Number.isNaN(parsed) ? fallback : parsed;
    }
    return fallback;
}

export function formatStickerSummary(sticker: JsonValue | undefined, index: number): string {
    if (!isJsonData(sticker)) {
        return `${index + 1}. 알 수 없는 스티커`;
    }

    const parts: string[] = [];
    const name =
        typeof sticker.name === 'string' && sticker.name.length > 0 ? sticker.name : '이름 없음';
    parts.push(`${index + 1}. ${name}`);

    const metadata: string[] = [];
    if (typeof sticker.id === 'string' && sticker.id.length > 0) {
        metadata.push(`ID ${sticker.id}`);
    }

    let formatLabel: string | undefined;
    if (typeof sticker.format === 'number') {
        formatLabel = STICKER_FORMAT_LABELS[sticker.format] ?? `형식 ${sticker.format}`;
    } else if (typeof sticker.format_type === 'number') {
        formatLabel = STICKER_FORMAT_LABELS[sticker.format_type] ?? `형식 ${sticker.format_type}`;
    } else if (typeof sticker.format === 'string') {
        formatLabel = sticker.format;
    }

    if (formatLabel) {
        metadata.push(formatLabel);
    }

    if (metadata.length > 0) {
        parts.push(`(${metadata.join(', ')})`);
    }

    return parts.join(' ');
}

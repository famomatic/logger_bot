import type { JsonValue } from '../../types/json.js';
import { STICKER_FORMAT_LABELS } from './constants.js';
import { isJsonData } from './types.js';

/**
 * JsonValue를 문자열로 안전 변환합니다. nullish면 fallback을 반환합니다.
 */
export function str(val: JsonValue | undefined, fallback = ''): string {
    if (val == null) return fallback;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return JSON.stringify(val);
}

/**
 * JsonValue를 숫자로 안전 변환합니다. 유효하지 않으면 fallback을 반환합니다.
 */
export function num(val: JsonValue | undefined, fallback = 0): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const parsed = Number(val);
        return Number.isNaN(parsed) ? fallback : parsed;
    }
    return fallback;
}

/**
 * 스티커 로그 항목 1개를 사람이 읽기 쉬운 요약 문자열로 변환합니다.
 */
export function formatStickerSummary(sticker: JsonValue | undefined, index: number): string {
    if (!isJsonData(sticker)) {
        return `${index + 1}. Unknown sticker`;
    }

    const parts: string[] = [];
    const name =
        typeof sticker.name === 'string' && sticker.name.length > 0 ? sticker.name : 'Unnamed';
    parts.push(`${index + 1}. ${name}`);

    const metadata: string[] = [];
    if (typeof sticker.id === 'string' && sticker.id.length > 0) {
        metadata.push(`ID ${sticker.id}`);
    }

    let formatLabel: string | undefined;
    if (typeof sticker.format === 'number') {
        formatLabel = STICKER_FORMAT_LABELS[sticker.format] ?? `Format ${sticker.format}`;
    } else if (typeof sticker.format_type === 'number') {
        formatLabel = STICKER_FORMAT_LABELS[sticker.format_type] ?? `Format ${sticker.format_type}`;
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

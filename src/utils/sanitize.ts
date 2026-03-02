import path from 'path';

/**
 * 파일명에서 경로 요소/허용되지 않는 문자를 제거해 안전한 저장용 이름으로 정규화합니다.
 */
export function sanitizeFilename(name: string): string {
    const base = path.basename(name);
    return base
        .replace(/\.+/g, '.')
        .replace(/[\\/]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * SQL 문자열 리터럴 처리 시 충돌 가능한 문자를 이스케이프합니다.
 */
export function sanitizeStringForSQL(str: string): string {
    return str
        .replace(/\\/g, '\\\\') // 백슬래시 우선 처리
        .replace(/"/g, '\\"')
        .replace(/'/g, "''");
}

/**
 * 객체/배열을 재귀 순회하며 모든 문자열 값을 SQL-safe 형태로 변환합니다.
 */
export function sanitizeObjectStrings<T>(obj: T): T {
    if (Array.isArray(obj)) {
        return obj.map((v: unknown) => sanitizeObjectStrings(v)) as T;
    }
    if (obj !== null && typeof obj === 'object') {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            sanitized[key] = sanitizeObjectStrings(value);
        }
        return sanitized as T;
    }
    if (typeof obj === 'string') {
        return sanitizeStringForSQL(obj) as T;
    }
    return obj;
}

/**
 * 코드블록 본문 내 백틱 연속 문자열을 분리해 Discord 마크다운 깨짐을 방지합니다.
 */
export function escapeCodeBlockContent(content: string): string {
    return content.replace(/`{3,}/g, (match) => {
        let result = '';
        let remaining = match;
        while (remaining.length >= 3) {
            result += remaining.slice(0, 2) + '\u200b';
            remaining = remaining.slice(2);
        }
        return result + remaining;
    });
}

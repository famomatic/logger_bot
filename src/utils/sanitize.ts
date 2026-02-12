import path from 'path';

export function sanitizeFilename(name: string): string {
  const base = path.basename(name);
  return base.replace(/\.+/g, '.').replace(/[\\/]/g, '')
             .replace(/[^a-zA-Z0-9._-]/g, '_');
}

// 문자열에서 SQL 파싱에 혼동을 줄 수 있는 문자를 이스케이프합니다.
export function sanitizeStringForSQL(str: string): string {
  return str
    .replace(/\\/g, '\\\\') // 백슬래시 우선 처리
    .replace(/"/g, '\\"')
    .replace(/'/g, "''");
}

// 객체 내 모든 문자열 값을 재귀적으로 이스케이프합니다.
export function sanitizeObjectStrings<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((v: unknown) => sanitizeObjectStrings(v)) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      sanitized[key] = sanitizeObjectStrings(value);
    }
    return sanitized as T;
  }
  if (typeof obj === 'string') {
    return sanitizeStringForSQL(obj) as unknown as T;
  }
  return obj;
}

// 코드 블록 안에서 ``` 문자열이 있으면 깨지지 않도록 분리합니다.
export function escapeCodeBlockContent(content: string): string {
  return content.replace(/`{3,}/g, match => {
    let result = '';
    let remaining = match;
    while (remaining.length >= 3) {
      result += remaining.slice(0, 2) + '\u200b';
      remaining = remaining.slice(2);
    }
    return result + remaining;
  });
}

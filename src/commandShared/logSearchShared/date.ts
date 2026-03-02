/**
 * `YYYY-MM-DD` 형식 문자열을 UTC 기준 Date로 파싱합니다.
 * `isEndDate`가 true면 해당 날짜의 23:59:59.999로 맞춥니다.
 */
export function parseDateString(dateString: string, isEndDate = false): Date | null {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (!parts) return null;

    const year = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1; // Month is 0-indexed
    const day = parseInt(parts[3], 10);

    const date = new Date(Date.UTC(year, month, day));

    if (Number.isNaN(date.getTime())) return null;
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    if (isEndDate) {
        date.setUTCHours(23, 59, 59, 999);
    } else {
        date.setUTCHours(0, 0, 0, 0);
    }
    return date;
}

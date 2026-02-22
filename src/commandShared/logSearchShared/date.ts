// 날짜 문자열(YYYY-MM-DD)을 Date 객체로 변환하는 헬퍼 함수
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

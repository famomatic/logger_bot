export const PAGE_SIZE = 5;
export const MAX_TEXT_SIZE = 3900;

export const STICKER_FORMAT_LABELS: Record<number, string> = {
    1: 'PNG',
    2: 'APNG',
    3: 'LOTTIE',
    4: 'GIF',
};

export const LOG_SEARCH_MESSAGES = {
    noRecentLogsTitle: '최근 로그 없음',
    noSearchResultsTitle: '검색 결과 없음',
    noRecentLogsDescription: '이 서버에 기록된 최근 로그가 없습니다.',
    noSearchResultsDescription: '지정된 조건으로 검색된 로그가 없습니다.',
    summaryRecentPrefix: '최근 로그',
    summarySearchPrefix: '검색 결과',
    renderFailureMessage: '로그를 표시하는 중 문제가 발생했습니다. (컴포넌트 생성 실패 또는 표시할 내용 없음)',
    genericErrorTitle: '오류 발생',
    genericErrorDescription: '로그 표시 중 오류가 발생했습니다.',
} as const;

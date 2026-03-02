import type { SupportedLocale } from '../../types/i18n.js';
import { t } from '../../i18n/index.js';

/** 로그 검색 UI 1페이지당 표시 건수입니다. */
export const PAGE_SIZE = 5;
/** Discord 컴포넌트 텍스트 조합 시 사용하는 안전 최대 길이입니다. */
export const MAX_TEXT_SIZE = 3900;

/** Discord 스티커 포맷 코드를 표시 문자열로 변환하는 매핑입니다. */
export const STICKER_FORMAT_LABELS: Record<number, string> = {
    1: 'PNG',
    2: 'APNG',
    3: 'LOTTIE',
    4: 'GIF',
};

/**
 * 로그 검색 UI에서 사용하는 locale별 고정 문구 묶음을 반환합니다.
 */
export function getLogSearchMessages(locale: SupportedLocale) {
    return {
        noRecentLogsTitle: t(locale, 'logSearchShared.noRecentLogsTitle'),
        noSearchResultsTitle: t(locale, 'logSearchShared.noSearchResultsTitle'),
        noRecentLogsDescription: t(locale, 'logSearchShared.noRecentLogsDescription'),
        noSearchResultsDescription: t(locale, 'logSearchShared.noSearchResultsDescription'),
        summaryRecentPrefix: t(locale, 'logSearchShared.summaryRecentPrefix'),
        summarySearchPrefix: t(locale, 'logSearchShared.summarySearchPrefix'),
        renderFailureMessage: t(locale, 'logSearchShared.renderFailureMessage'),
        genericErrorTitle: t(locale, 'logSearchShared.genericErrorTitle'),
        genericErrorDescription: t(locale, 'logSearchShared.genericErrorDescription'),
    };
}

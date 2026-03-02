import type { JsonData, JsonValue } from '../../types/json.js';
import type { JsonValueGuardHelpers } from '../../types/logSearchShared.js';

/**
 * JsonValue가 객체형 JsonData인지 판별하는 타입 가드입니다.
 */
export const isJsonData = (value: JsonValue | undefined): value is JsonData =>
    value != null && typeof value === 'object' && !Array.isArray(value);

/**
 * 로그 렌더러에서 공통으로 쓰는 JsonValue 타입 가드 모음입니다.
 */
export const jsonValueGuards: JsonValueGuardHelpers = {
    isJsonData,
    isJsonArray: (value): value is JsonValue[] => Array.isArray(value),
    isJsonString: (value): value is string => typeof value === 'string',
    isJsonNumber: (value): value is number => typeof value === 'number',
};

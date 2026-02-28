import type { JsonData, JsonValue } from '../../types/json.js';
import type { JsonValueGuardHelpers } from '../../types/logSearchShared.js';

export const isJsonData = (value: JsonValue | undefined): value is JsonData =>
    value != null && typeof value === 'object' && !Array.isArray(value);

export const jsonValueGuards: JsonValueGuardHelpers = {
    isJsonData,
    isJsonArray: (value): value is JsonValue[] => Array.isArray(value),
    isJsonString: (value): value is string => typeof value === 'string',
    isJsonNumber: (value): value is number => typeof value === 'number',
};

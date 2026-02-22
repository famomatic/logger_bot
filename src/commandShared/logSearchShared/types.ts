import type { JsonData, JsonValue } from '../../types/json.js';
import type { AttachmentLogData, LogEntry } from '../../types/logs.js';

export interface LogSearchRenderContext {
    log: LogEntry;
    eventData: JsonData;
    friendlyEventName: string;
}

export interface RenderedEventDetails {
    eventSpecificsText: string;
    thumbnailUserId?: string;
}

export interface AttachmentRenderResult {
    attachment: AttachmentLogData;
    displayText?: string;
    attachmentFilename?: string;
}

export interface LogRenderResult {
    timestampContent: string;
    infoTextContent: string;
    eventDetails: RenderedEventDetails;
    attachments: AttachmentRenderResult[];
}

export interface JsonValueGuardHelpers {
    isJsonData(value: JsonValue | undefined): value is JsonData;
    isJsonArray(value: JsonValue | undefined): value is JsonValue[];
    isJsonString(value: JsonValue | undefined): value is string;
    isJsonNumber(value: JsonValue | undefined): value is number;
}

export const isJsonData = (value: JsonValue | undefined): value is JsonData =>
    value != null && typeof value === 'object' && !Array.isArray(value);

export const jsonValueGuards: JsonValueGuardHelpers = {
    isJsonData,
    isJsonArray: (value): value is JsonValue[] => Array.isArray(value),
    isJsonString: (value): value is string => typeof value === 'string',
    isJsonNumber: (value): value is number => typeof value === 'number',
};

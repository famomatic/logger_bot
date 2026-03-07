import type { JsonData, JsonValue } from './json.js';
import type { AttachmentLogData, LogEntry } from './logs.js';

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

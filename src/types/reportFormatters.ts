export interface EventTypeCountLike {
    eventType: string;
    count: number;
}

export interface IdCountLike {
    id: string;
    count: number;
}

export interface FormatListOptions {
    locale?: string;
    emptyText?: string;
    countUnit?: string;
}

export type MentionEntityType = 'user' | 'channel';

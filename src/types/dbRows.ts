export interface LatestMessageCreateCheckpointRow {
    channel_id: string;
    target_id: string;
}

export interface BatchInsertedLogRow {
    event_id: string;
    event_type: string;
    guild_id: string;
    user_id: string | null;
    channel_id: string | null;
    target_id: string | null;
    data: Record<string, unknown>;
    timestamp: Date;
}

export interface FetchedLogRow {
    id: number;
    event_type: string;
    user_id: string | null;
    channel_id: string | null;
    target_id: string | null;
    data: Record<string, unknown>;
    timestamp: Date;
}

export interface CountRow {
    count: string;
}

export interface GuildLogStatsRow {
    total_logs: string;
    message_create_count: string;
    text_message_count: string;
    total_text_characters: string;
    attachment_count: string;
    sticker_count: string;
}

export interface ScopeSummaryRow {
    total_logs: string;
    message_create_count: string;
    message_update_count: string;
    message_delete_count: string;
    moderation_action_count: string;
    attachment_count: string;
    sticker_count: string;
    last_activity_at: Date | null;
    last_24h_count: string;
    prev_24h_count: string;
}

export interface RankedRow {
    id: string | null;
    count: string;
}

export interface RankedEventTypeRow {
    event_type: string;
    count: string;
}

export interface EventPeakDayRow {
    event_day: Date | null;
    count: string;
}

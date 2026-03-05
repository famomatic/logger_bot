import type { AttachmentData } from './commands.js';

export type AttachmentLogData = Pick<AttachmentData, 'id' | 'filename'> &
    Partial<Pick<AttachmentData, 'storagePath' | 'discordUrl'>>;

export interface LogEventRecord {
    eventType: string;
    guildId: string;
    userId: string | null;
    channelId: string | null;
    targetId: string;
    data: Record<string, unknown>;
    timestamp: Date;
}

export interface EventLogInput {
    eventType: string;
    guildId: string | null | undefined;
    userId: string | null;
    channelId: string | null;
    targetId: string | null;
    data: Record<string, unknown>;
    timestamp: Date;
}

export interface RankedEventType {
    eventType: string;
    count: number;
}

export interface RankedEntity {
    id: string;
    count: number;
}

export interface LogScopeReport {
    totalLogs: number;
    messageCreateCount: number;
    messageUpdateCount: number;
    messageDeleteCount: number;
    moderationActionCount: number;
    attachmentCount: number;
    stickerCount: number;
    lastActivityAt: Date | null;
    last24hCount: number;
    prev24hCount: number;
    trendPercent: number | null;
    topEventTypes: RankedEventType[];
    topChannels: RankedEntity[];
    topUsers: RankedEntity[];
}

export interface SearchLogsParams {
    guildId: string;
    keyword?: string;
    userId?: string;
    channelId?: string;
    startDate?: Date;
    endDate?: Date;
    eventType?: string;
    limit: number;
    offset?: number;
}

export interface LogEntry {
    id: number;
    event_type: string;
    guild_id: string;
    user_id: string | null;
    channel_id: string | null;
    target_id: string | null;
    timestamp: Date;
    event_data: Record<string, unknown>;
}

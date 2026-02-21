export interface ChannelBackfillStat {
    processed: number;
    newlyLogged: number;
    name: string;
}

export interface GuildBackfillResult {
    totalChannels: number;
    processedCount: number;
    newlyLoggedCount: number;
    errorCount: number;
    uniqueUserCount: number;
    durationSeconds: number;
    channelStats: Record<string, ChannelBackfillStat>;
}

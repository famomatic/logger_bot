export interface AlertSubscriptionRow {
    guild_id: string;
    channel_id: string;
    category: string;
}

export interface AlertSubscription {
    guildId: string;
    channelId: string;
    category: string;
    eventTypes: string[];
}

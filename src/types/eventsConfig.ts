export interface EventConfig {
    eventName: string;
    friendlyName: string;
    dbEventType: string;
    category: string;
    searchableFields?: string[];
    includeInChoices?: boolean;
}

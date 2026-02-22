import type {
    ChatInputCommandInteraction,
    MessageComponentInteraction,
    ThumbnailBuilder,
} from 'discord.js';
import type { JsonData } from '../../../types/json.js';

export type LogSearchInteraction = ChatInputCommandInteraction | MessageComponentInteraction;

export interface GroupRendererInput {
    eventType: string;
    eventData: JsonData;
    interaction: LogSearchInteraction;
    logUserId: string | null;
}

export interface GroupRendererResult {
    eventSpecificsText: string;
    thumbnailComponent?: ThumbnailBuilder;
}

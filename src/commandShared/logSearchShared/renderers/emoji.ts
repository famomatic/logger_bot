import {
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';
import type { JsonData, JsonValue } from '../../../types/json.js';
import { str } from '../formatters.js';
import { isJsonData } from '../types.js';

type EmojiEventType = 'emojiCreate' | 'emojiUpdate' | 'emojiDelete';

interface RenderEmojiEventParams {
    eventType: EmojiEventType;
    data: JsonData;
    interaction: ChatInputCommandInteraction | MessageComponentInteraction;
    logUserId?: string | null;
}

interface EmojiRenderResult {
    eventSpecificsText: string;
    thumbnailComponent?: ThumbnailBuilder;
}

function getEmojiData(value: JsonValue | undefined): JsonData | undefined {
    return isJsonData(value) ? value : undefined;
}

function getEmojiThumbnailUrl(emoji: JsonData): string {
    return `https://cdn.discordapp.com/emojis/${str(emoji.id)}.${emoji.animated ? 'gif' : 'png'}?size=64`;
}

async function fetchUserThumbnail(
    interaction: ChatInputCommandInteraction | MessageComponentInteraction,
    userId: string,
): Promise<ThumbnailBuilder | undefined> {
    try {
        const user = await interaction.client.users.fetch(userId);
        return new ThumbnailBuilder({
            media: {
                url: user.displayAvatarURL({
                    forceStatic: false,
                    size: 64,
                }),
            },
        });
    } catch {
        return undefined;
    }
}

async function renderEmojiCreateEvent(params: RenderEmojiEventParams): Promise<EmojiRenderResult> {
    const { data, interaction, logUserId } = params;
    const emojiDetails: string[] = [];
    const emoji = getEmojiData(data.emoji) ?? data;
    let thumbnailComponent: ThumbnailBuilder | undefined;

    if (emoji.id) {
        emojiDetails.push(`**이모지 이름:** ${str(emoji.name, 'N/A')}`);
        emojiDetails.push(`**ID:** ${str(emoji.id)}`);
        emojiDetails.push(`**표시:** <:${str(emoji.name)}:${str(emoji.id)}>`);
        if (emoji.animated) {
            emojiDetails.push('**애니메이션됨:** 예');
        }
    }

    if (emoji.id) {
        thumbnailComponent = new ThumbnailBuilder({
            media: {
                url: getEmojiThumbnailUrl(emoji),
            },
        });
    } else if (logUserId) {
        thumbnailComponent = await fetchUserThumbnail(interaction, logUserId);
    }

    return {
        eventSpecificsText:
            emojiDetails.length > 0 ? emojiDetails.join('\n') : '이모지 생성 정보 없음',
        thumbnailComponent,
    };
}

async function renderEmojiUpdateEvent(params: RenderEmojiEventParams): Promise<EmojiRenderResult> {
    const { data, interaction, logUserId } = params;
    const emojiDetails: string[] = [];
    const oldEmoji = getEmojiData(data.oldEmoji);
    const newEmoji = getEmojiData(data.newEmoji) ?? getEmojiData(data.emoji);
    let thumbnailComponent: ThumbnailBuilder | undefined;

    if (newEmoji?.id) {
        emojiDetails.push(
            `**이모지:** ${str(newEmoji.name, 'N/A')} (ID: ${str(newEmoji.id)}) <:${str(newEmoji.name)}:${str(newEmoji.id)}>`,
        );

        if (oldEmoji) {
            if (oldEmoji.name !== newEmoji.name) {
                emojiDetails.push(
                    `**이름 변경:** \\\`${str(oldEmoji.name)}\\\` -> \\\`${str(newEmoji.name)}\\\``,
                );
            }
        } else {
            emojiDetails.push('(이전 이모지 정보 없음)');
        }
    } else {
        emojiDetails.push('이모지 정보 없음');
    }

    if (newEmoji?.id) {
        thumbnailComponent = new ThumbnailBuilder({
            media: {
                url: getEmojiThumbnailUrl(newEmoji),
            },
        });
    } else if (logUserId) {
        thumbnailComponent = await fetchUserThumbnail(interaction, logUserId);
    }

    return {
        eventSpecificsText:
            emojiDetails.length > 0 ? emojiDetails.join('\n') : '이모지 업데이트 정보 없음',
        thumbnailComponent,
    };
}

async function renderEmojiDeleteEvent(params: RenderEmojiEventParams): Promise<EmojiRenderResult> {
    const { data, interaction, logUserId } = params;
    const emojiDetails: string[] = [];
    const emoji = getEmojiData(data.emoji) ?? data;
    let thumbnailComponent: ThumbnailBuilder | undefined;

    if (emoji.id) {
        emojiDetails.push(`**삭제된 이모지 이름:** ${str(emoji.name, 'N/A')}`);
        emojiDetails.push(`**ID:** ${str(emoji.id)}`);
    }

    if (logUserId) {
        thumbnailComponent = await fetchUserThumbnail(interaction, logUserId);
    }

    return {
        eventSpecificsText:
            emojiDetails.length > 0 ? emojiDetails.join('\n') : '이모지 삭제 정보 없음',
        thumbnailComponent,
    };
}

export async function renderEvent(
    params: RenderEmojiEventParams,
): Promise<EmojiRenderResult> {
    switch (params.eventType) {
        case 'emojiCreate':
            return renderEmojiCreateEvent(params);
        case 'emojiUpdate':
            return renderEmojiUpdateEvent(params);
        case 'emojiDelete':
            return renderEmojiDeleteEvent(params);
    }
}

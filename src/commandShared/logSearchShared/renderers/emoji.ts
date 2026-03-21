import {
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';

import { getInteractionLocale, t } from '../deps.js';
import { str } from '../formatters.js';
import { isJsonData } from '../types.js';

import type { JsonData, JsonValue } from '../deps.js';

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

/**
 * 이모지 이벤트 payload에서 안전하게 JsonData를 추출합니다.
 */
function getEmojiData(value: JsonValue | undefined): JsonData | undefined {
    return isJsonData(value) ? value : undefined;
}

/**
 * 이모지 ID/animated 여부로 CDN 썸네일 URL을 생성합니다.
 */
function getEmojiThumbnailUrl(emoji: JsonData): string {
    return `https://cdn.discordapp.com/emojis/${str(emoji.id)}.${emoji.animated ? 'gif' : 'png'}?size=64`;
}

/**
 * 사용자 ID로 아바타 썸네일 컴포넌트를 조회/생성합니다.
 */
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

/**
 * emojiCreate 로그의 표시 텍스트와 썸네일을 생성합니다.
 */
async function renderEmojiCreateEvent(params: RenderEmojiEventParams): Promise<EmojiRenderResult> {
    const { data, interaction, logUserId } = params;
    const locale = getInteractionLocale(interaction);
    const emojiDetails: string[] = [];
    const emoji = getEmojiData(data.emoji) ?? data;
    let thumbnailComponent: ThumbnailBuilder | undefined;

    if (emoji.id) {
        emojiDetails.push(
            `${t(locale, 'logSearchShared.legacy.emojiNameLabel')} ${str(emoji.name, 'N/A')}`,
        );
        emojiDetails.push(`**ID:** ${str(emoji.id)}`);
        emojiDetails.push(
            `${t(locale, 'logSearchShared.emoji.displayLabel')} <:${str(emoji.name)}:${str(emoji.id)}>`,
        );
        if (emoji.animated) {
            emojiDetails.push(
                `${t(locale, 'logSearchShared.emoji.animatedLabel')} ${t(locale, 'logSearchShared.legacy.yes')}`,
            );
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
            emojiDetails.length > 0
                ? emojiDetails.join('\n')
                : t(locale, 'logSearchShared.emoji.createNoInfo'),
        thumbnailComponent,
    };
}

/**
 * emojiUpdate 로그의 변경 요약 텍스트와 썸네일을 생성합니다.
 */
async function renderEmojiUpdateEvent(params: RenderEmojiEventParams): Promise<EmojiRenderResult> {
    const { data, interaction, logUserId } = params;
    const locale = getInteractionLocale(interaction);
    const emojiDetails: string[] = [];
    const oldEmoji = getEmojiData(data.oldEmoji);
    const newEmoji = getEmojiData(data.newEmoji) ?? getEmojiData(data.emoji);
    let thumbnailComponent: ThumbnailBuilder | undefined;

    if (newEmoji?.id) {
        emojiDetails.push(
            `${t(locale, 'logSearchShared.legacy.emojiLabel')} ${str(newEmoji.name, 'N/A')} (ID: ${str(newEmoji.id)}) <:${str(newEmoji.name)}:${str(newEmoji.id)}>`,
        );

        if (oldEmoji) {
            if (oldEmoji.name !== newEmoji.name) {
                emojiDetails.push(
                    `${t(locale, 'logSearchShared.legacy.nameChangedLabel')} \\\`${str(oldEmoji.name)}\\\` -> \\\`${str(newEmoji.name)}\\\``,
                );
            }
        } else {
            emojiDetails.push(t(locale, 'logSearchShared.emoji.noPrevious'));
        }
    } else {
        emojiDetails.push(t(locale, 'logSearchShared.emoji.noInfo'));
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
            emojiDetails.length > 0
                ? emojiDetails.join('\n')
                : t(locale, 'logSearchShared.emoji.updateNoInfo'),
        thumbnailComponent,
    };
}

/**
 * emojiDelete 로그의 표시 텍스트와 썸네일을 생성합니다.
 */
async function renderEmojiDeleteEvent(params: RenderEmojiEventParams): Promise<EmojiRenderResult> {
    const { data, interaction, logUserId } = params;
    const locale = getInteractionLocale(interaction);
    const emojiDetails: string[] = [];
    const emoji = getEmojiData(data.emoji) ?? data;
    let thumbnailComponent: ThumbnailBuilder | undefined;

    if (emoji.id) {
        emojiDetails.push(
            `${t(locale, 'logSearchShared.legacy.deletedEmojiNameLabel')} ${str(emoji.name, 'N/A')}`,
        );
        emojiDetails.push(`**ID:** ${str(emoji.id)}`);
    }

    if (logUserId) {
        thumbnailComponent = await fetchUserThumbnail(interaction, logUserId);
    }

    return {
        eventSpecificsText:
            emojiDetails.length > 0
                ? emojiDetails.join('\n')
                : t(locale, 'logSearchShared.emoji.deleteNoInfo'),
        thumbnailComponent,
    };
}

/**
 * 이모지 이벤트 타입별 렌더러를 분기 호출합니다.
 */
export async function renderEvent(params: RenderEmojiEventParams): Promise<EmojiRenderResult> {
    switch (params.eventType) {
        case 'emojiCreate':
            return renderEmojiCreateEvent(params);
        case 'emojiUpdate':
            return renderEmojiUpdateEvent(params);
        case 'emojiDelete':
            return renderEmojiDeleteEvent(params);
    }
}

import {
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';
import type { JsonData, JsonValue } from '../../../types/json.js';
import { STICKER_FORMAT_LABELS } from '../constants.js';
import { num, str } from '../formatters.js';
import { isJsonData } from '../types.js';

type StickerEventType = 'stickerCreate' | 'stickerUpdate' | 'stickerDelete';

interface RenderStickerEventParams {
    eventType: StickerEventType;
    data: JsonData;
    interaction: ChatInputCommandInteraction | MessageComponentInteraction;
    logUserId?: string | null;
    currentThumbnail?: ThumbnailBuilder;
}

interface StickerRenderResult {
    eventSpecificsText: string;
    thumbnailComponent?: ThumbnailBuilder;
}

function getStickerData(value: JsonValue | undefined): JsonData | undefined {
    return isJsonData(value) ? value : undefined;
}

function formatStickerTags(tags: JsonValue | undefined): string {
    if (Array.isArray(tags)) {
        return tags.map((tag) => str(tag)).join(', ');
    }
    return str(tags);
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

async function renderStickerCreateEvent(
    params: RenderStickerEventParams,
): Promise<StickerRenderResult> {
    const { data, interaction, logUserId, currentThumbnail } = params;
    const stickerDetails: string[] = [];
    const sticker = getStickerData(data.sticker) ?? data;
    let thumbnailComponent = currentThumbnail;

    if (sticker.id) {
        stickerDetails.push(`**스티커 이름:** ${str(sticker.name, 'N/A')}`);
        stickerDetails.push(`**ID:** ${str(sticker.id)}`);

        const tags = sticker.tags;
        if (tags) {
            stickerDetails.push(`**태그:** ${formatStickerTags(tags)}`);
        }

        if (sticker.description) {
            stickerDetails.push(`**설명:** ${str(sticker.description)}`);
        }

        if (sticker.format_type !== undefined) {
            stickerDetails.push(
                `**포맷:** ${STICKER_FORMAT_LABELS[num(sticker.format_type)] ?? `알 수 없는 포맷 (${str(sticker.format_type)})`}`,
            );
        }

        if (sticker.guildId) {
            stickerDetails.push(`**서버 ID:** ${str(sticker.guildId)}`);
        }
    }

    if (sticker.id && sticker.format_type !== 3) {
        try {
            const fetchedSticker = await interaction.guild?.stickers.fetch(str(sticker.id));
            if (fetchedSticker?.url) {
                thumbnailComponent = new ThumbnailBuilder({
                    media: { url: fetchedSticker.url },
                });
            }
        } catch {
            /* empty */
        }
    }

    if (!thumbnailComponent && logUserId) {
        thumbnailComponent = await fetchUserThumbnail(interaction, logUserId);
    }

    return {
        eventSpecificsText:
            stickerDetails.length > 0 ? stickerDetails.join('\n') : '스티커 생성 정보 없음',
        thumbnailComponent,
    };
}

async function renderStickerUpdateEvent(
    params: RenderStickerEventParams,
): Promise<StickerRenderResult> {
    const { data, interaction, logUserId, currentThumbnail } = params;
    const stickerDetails: string[] = [];
    const oldSticker = getStickerData(data.oldSticker);
    const newSticker = getStickerData(data.newSticker) ?? getStickerData(data.sticker);
    let thumbnailComponent = currentThumbnail;

    if (newSticker?.id) {
        stickerDetails.push(`**스티커:** ${str(newSticker.name, 'N/A')} (ID: ${str(newSticker.id)})`);

        if (oldSticker) {
            if (oldSticker.name !== newSticker.name) {
                stickerDetails.push(
                    `**이름 변경:** \\\`${str(oldSticker.name, '(없음)')}\\\` -> \\\`${str(newSticker.name, '(없음)')}\\\``,
                );
            }

            if (oldSticker.description !== newSticker.description) {
                stickerDetails.push(
                    `**설명 변경:** \\\`${str(oldSticker.description, '(없음)')}\\\` -> \\\`${str(newSticker.description, '(없음)')}\\\``,
                );
            }

            const oldTags = oldSticker.tags;
            const newTags = newSticker.tags;
            const oldTagsText = Array.isArray(oldTags)
                ? oldTags.map((tag) => str(tag)).join(', ')
                : str(oldTags, '');
            const newTagsText = Array.isArray(newTags)
                ? newTags.map((tag) => str(tag)).join(', ')
                : str(newTags, '');

            if (oldTagsText !== newTagsText) {
                stickerDetails.push(
                    `**태그 변경:** \\\`${oldTagsText || '(없음)'}\\\` -> \\\`${newTagsText || '(없음)'}\\\``,
                );
            }
        } else {
            stickerDetails.push('(이전 스티커 정보 없음, 새 정보만 표시)');

            if (newSticker.description) {
                stickerDetails.push(`**설명:** ${str(newSticker.description)}`);
            }

            const newTags = newSticker.tags;
            if (newTags) {
                stickerDetails.push(`**태그:** ${formatStickerTags(newTags)}`);
            }
        }
    } else {
        stickerDetails.push('스티커 정보 없음');
    }

    if (newSticker?.id && newSticker.format_type !== 3) {
        try {
            const fetchedSticker = await interaction.guild?.stickers.fetch(str(newSticker.id));
            if (fetchedSticker?.url) {
                thumbnailComponent = new ThumbnailBuilder({
                    media: { url: fetchedSticker.url },
                });
            }
        } catch {
            /* empty */
        }
    }

    if (!thumbnailComponent && logUserId) {
        thumbnailComponent = await fetchUserThumbnail(interaction, logUserId);
    }

    return {
        eventSpecificsText:
            stickerDetails.length > 0 ? stickerDetails.join('\n') : '스티커 업데이트 정보 없음',
        thumbnailComponent,
    };
}

async function renderStickerDeleteEvent(
    params: RenderStickerEventParams,
): Promise<StickerRenderResult> {
    const { data, interaction, logUserId, currentThumbnail } = params;
    const stickerDetails: string[] = [];
    const sticker = getStickerData(data.sticker) ?? data;
    let thumbnailComponent = currentThumbnail;

    if (sticker.id) {
        stickerDetails.push(`**삭제된 스티커 이름:** ${str(sticker.name, 'N/A')}`);
        stickerDetails.push(`**ID:** ${str(sticker.id)}`);
        const tags = sticker.tags;
        if (tags) {
            stickerDetails.push(`**태그:** ${formatStickerTags(tags)}`);
        }
    }

    if (logUserId) {
        const fetchedThumbnail = await fetchUserThumbnail(interaction, logUserId);
        if (fetchedThumbnail) {
            thumbnailComponent = fetchedThumbnail;
        }
    }

    return {
        eventSpecificsText:
            stickerDetails.length > 0 ? stickerDetails.join('\n') : '스티커 삭제 정보 없음',
        thumbnailComponent,
    };
}

export async function renderEvent(
    params: RenderStickerEventParams,
): Promise<StickerRenderResult> {
    switch (params.eventType) {
        case 'stickerCreate':
            return renderStickerCreateEvent(params);
        case 'stickerUpdate':
            return renderStickerUpdateEvent(params);
        case 'stickerDelete':
            return renderStickerDeleteEvent(params);
    }
}

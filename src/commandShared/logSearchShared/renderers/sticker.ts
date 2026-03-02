import {
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';
import type { JsonData, JsonValue } from '../../../types/json.js';
import { getInteractionLocale, t } from '../../../i18n/index.js';
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

/**
 * 스티커 이벤트 payload에서 안전하게 JsonData를 추출합니다.
 */
function getStickerData(value: JsonValue | undefined): JsonData | undefined {
    return isJsonData(value) ? value : undefined;
}

/**
 * 스티커 태그 배열/문자열을 표시용 문자열로 포맷합니다.
 */
function formatStickerTags(tags: JsonValue | undefined): string {
    if (Array.isArray(tags)) {
        return tags.map((tag) => str(tag)).join(', ');
    }
    return str(tags);
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
 * stickerCreate 로그의 표시 텍스트와 썸네일을 생성합니다.
 */
async function renderStickerCreateEvent(
    params: RenderStickerEventParams,
): Promise<StickerRenderResult> {
    const { data, interaction, logUserId, currentThumbnail } = params;
    const locale = getInteractionLocale(interaction);
    const stickerDetails: string[] = [];
    const sticker = getStickerData(data.sticker) ?? data;
    let thumbnailComponent = currentThumbnail;

    if (sticker.id) {
        stickerDetails.push(
            `${t(locale, 'logSearchShared.legacy.stickerNameLabel')} ${str(sticker.name, 'N/A')}`,
        );
        stickerDetails.push(`**ID:** ${str(sticker.id)}`);

        const tags = sticker.tags;
        if (tags) {
            stickerDetails.push(
                `${t(locale, 'logSearchShared.legacy.tagsLabel')} ${formatStickerTags(tags)}`,
            );
        }

        if (sticker.description) {
            stickerDetails.push(
                `${t(locale, 'logSearchShared.legacy.descriptionLabel')} ${str(sticker.description)}`,
            );
        }

        if (sticker.format_type !== undefined) {
            stickerDetails.push(
                `${t(locale, 'logSearchShared.legacy.formatLabel')} ${STICKER_FORMAT_LABELS[num(sticker.format_type)] ?? t(locale, 'logSearchShared.sticker.unknownFormat', { type: str(sticker.format_type) })}`,
            );
        }

        if (sticker.guildId) {
            stickerDetails.push(
                `${t(locale, 'logSearchShared.legacy.guildIdLabel')} ${str(sticker.guildId)}`,
            );
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
            stickerDetails.length > 0
                ? stickerDetails.join('\n')
                : t(locale, 'logSearchShared.sticker.createNoInfo'),
        thumbnailComponent,
    };
}

/**
 * stickerUpdate 로그의 변경 요약 텍스트와 썸네일을 생성합니다.
 */
async function renderStickerUpdateEvent(
    params: RenderStickerEventParams,
): Promise<StickerRenderResult> {
    const { data, interaction, logUserId, currentThumbnail } = params;
    const locale = getInteractionLocale(interaction);
    const stickerDetails: string[] = [];
    const oldSticker = getStickerData(data.oldSticker);
    const newSticker = getStickerData(data.newSticker) ?? getStickerData(data.sticker);
    let thumbnailComponent = currentThumbnail;

    if (newSticker?.id) {
        stickerDetails.push(
            `${t(locale, 'logSearchShared.legacy.stickerLabel')} ${str(newSticker.name, 'N/A')} (ID: ${str(newSticker.id)})`,
        );

        if (oldSticker) {
            if (oldSticker.name !== newSticker.name) {
                stickerDetails.push(
                    `${t(locale, 'logSearchShared.legacy.nameChangedLabel')} \\\`${str(oldSticker.name, t(locale, 'logSearchShared.legacy.none'))}\\\` -> \\\`${str(newSticker.name, t(locale, 'logSearchShared.legacy.none'))}\\\``,
                );
            }

            if (oldSticker.description !== newSticker.description) {
                stickerDetails.push(
                    `${t(locale, 'logSearchShared.sticker.descriptionChangedLabel')} \\\`${str(oldSticker.description, t(locale, 'logSearchShared.legacy.none'))}\\\` -> \\\`${str(newSticker.description, t(locale, 'logSearchShared.legacy.none'))}\\\``,
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
                    `${t(locale, 'logSearchShared.sticker.tagsChangedLabel')} \\\`${oldTagsText || t(locale, 'logSearchShared.legacy.none')}\\\` -> \\\`${newTagsText || t(locale, 'logSearchShared.legacy.none')}\\\``,
                );
            }
        } else {
            stickerDetails.push(t(locale, 'logSearchShared.sticker.noPrevious'));

            if (newSticker.description) {
                stickerDetails.push(
                    `${t(locale, 'logSearchShared.legacy.descriptionLabel')} ${str(newSticker.description)}`,
                );
            }

            const newTags = newSticker.tags;
            if (newTags) {
                stickerDetails.push(
                    `${t(locale, 'logSearchShared.legacy.tagsLabel')} ${formatStickerTags(newTags)}`,
                );
            }
        }
    } else {
        stickerDetails.push(t(locale, 'logSearchShared.sticker.noInfo'));
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
            stickerDetails.length > 0
                ? stickerDetails.join('\n')
                : t(locale, 'logSearchShared.sticker.updateNoInfo'),
        thumbnailComponent,
    };
}

/**
 * stickerDelete 로그의 표시 텍스트와 썸네일을 생성합니다.
 */
async function renderStickerDeleteEvent(
    params: RenderStickerEventParams,
): Promise<StickerRenderResult> {
    const { data, interaction, logUserId, currentThumbnail } = params;
    const locale = getInteractionLocale(interaction);
    const stickerDetails: string[] = [];
    const sticker = getStickerData(data.sticker) ?? data;
    let thumbnailComponent = currentThumbnail;

    if (sticker.id) {
        stickerDetails.push(
            `${t(locale, 'logSearchShared.legacy.deletedStickerNameLabel')} ${str(sticker.name, 'N/A')}`,
        );
        stickerDetails.push(`**ID:** ${str(sticker.id)}`);
        const tags = sticker.tags;
        if (tags) {
            stickerDetails.push(
                `${t(locale, 'logSearchShared.legacy.tagsLabel')} ${formatStickerTags(tags)}`,
            );
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
            stickerDetails.length > 0
                ? stickerDetails.join('\n')
                : t(locale, 'logSearchShared.sticker.deleteNoInfo'),
        thumbnailComponent,
    };
}

/**
 * 스티커 이벤트 타입별 렌더러를 분기 호출합니다.
 */
export async function renderEvent(params: RenderStickerEventParams): Promise<StickerRenderResult> {
    switch (params.eventType) {
        case 'stickerCreate':
            return renderStickerCreateEvent(params);
        case 'stickerUpdate':
            return renderStickerUpdateEvent(params);
        case 'stickerDelete':
            return renderStickerDeleteEvent(params);
    }
}

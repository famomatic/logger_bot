import {
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';

import { getInteractionLocale, t } from '../deps.js';
import { str } from '../formatters.js';
import { isJsonData } from '../types.js';

import type { JsonData, JsonValue } from '../deps.js';

interface RenderVoiceStateUpdateEventParams {
    data: JsonData;
    interaction: ChatInputCommandInteraction | MessageComponentInteraction;
}

interface VoiceRenderResult {
    eventSpecificsText: string;
    thumbnailComponent?: ThumbnailBuilder;
}

/**
 * 음성 상태 payload에서 안전하게 JsonData를 추출합니다.
 */
function getJsonData(value: JsonValue | undefined): JsonData | undefined {
    return isJsonData(value) ? value : undefined;
}

/**
 * voiceStateUpdate 로그의 상세 텍스트와 썸네일을 생성합니다.
 */
export async function renderEvent(
    params: RenderVoiceStateUpdateEventParams,
): Promise<VoiceRenderResult> {
    const { data, interaction } = params;
    const locale = getInteractionLocale(interaction);
    const details: string[] = [];
    const oldState = getJsonData(data.oldState);
    const newState = getJsonData(data.newState) ?? getJsonData(data.state);
    const member =
        getJsonData(data.member) ?? getJsonData(newState?.member) ?? getJsonData(oldState?.member);
    const memberUser = getJsonData(member?.user);

    const userId = str(newState?.id ?? oldState?.id ?? member?.id);
    const userTag = str(memberUser?.tag) || str(data.userTag);

    if (userId) {
        details.push(
            `${t(locale, 'logSearchShared.legacy.userLabel')} ${userTag || `<@${userId}>`} (${userId})`,
        );
    }

    const oldChannelId = str(oldState?.channelId);
    const newChannelId = str(newState?.channelId);

    if (oldChannelId && !newChannelId) {
        details.push(
            t(locale, 'logSearchShared.voice.leftChannel', {
                channelId: oldChannelId,
            }),
        );
    } else if (!oldChannelId && newChannelId) {
        details.push(
            t(locale, 'logSearchShared.voice.joinedChannel', {
                channelId: newChannelId,
            }),
        );
    } else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
        details.push(
            t(locale, 'logSearchShared.voice.movedChannel', {
                oldChannelId,
                newChannelId,
            }),
        );
    } else if (!oldChannelId && !newChannelId && oldState && newState) {
        if (oldState.serverMute !== newState.serverMute) {
            details.push(
                `${t(locale, 'logSearchShared.legacy.serverMuteLabel')} ${oldState.serverMute ? t(locale, 'logSearchShared.legacy.enabled') : t(locale, 'logSearchShared.legacy.disabled')} -> ${newState.serverMute ? t(locale, 'logSearchShared.legacy.enabled') : t(locale, 'logSearchShared.legacy.disabled')}`,
            );
        }
        if (oldState.serverDeaf !== newState.serverDeaf) {
            details.push(
                `${t(locale, 'logSearchShared.legacy.serverDeafLabel')} ${oldState.serverDeaf ? t(locale, 'logSearchShared.legacy.enabled') : t(locale, 'logSearchShared.legacy.disabled')} -> ${newState.serverDeaf ? t(locale, 'logSearchShared.legacy.enabled') : t(locale, 'logSearchShared.legacy.disabled')}`,
            );
        }
        if (oldState.selfMute !== newState.selfMute) {
            details.push(
                `${t(locale, 'logSearchShared.legacy.selfMuteLabel')} ${oldState.selfMute ? t(locale, 'logSearchShared.legacy.enabled') : t(locale, 'logSearchShared.legacy.disabled')} -> ${newState.selfMute ? t(locale, 'logSearchShared.legacy.enabled') : t(locale, 'logSearchShared.legacy.disabled')}`,
            );
        }
        if (oldState.selfDeaf !== newState.selfDeaf) {
            details.push(
                `${t(locale, 'logSearchShared.legacy.selfDeafLabel')} ${oldState.selfDeaf ? t(locale, 'logSearchShared.legacy.enabled') : t(locale, 'logSearchShared.legacy.disabled')} -> ${newState.selfDeaf ? t(locale, 'logSearchShared.legacy.enabled') : t(locale, 'logSearchShared.legacy.disabled')}`,
            );
        }
        if (oldState.streaming !== newState.streaming) {
            details.push(
                `${t(locale, 'logSearchShared.legacy.streamingLabel')} ${oldState.streaming ? t(locale, 'logSearchShared.legacy.started') : t(locale, 'logSearchShared.legacy.stopped')} -> ${newState.streaming ? t(locale, 'logSearchShared.legacy.started') : t(locale, 'logSearchShared.legacy.stopped')}`,
            );
        }
        if (oldState.selfVideo !== newState.selfVideo) {
            details.push(
                `${t(locale, 'logSearchShared.legacy.cameraLabel')} ${oldState.selfVideo ? t(locale, 'logSearchShared.legacy.on') : t(locale, 'logSearchShared.legacy.off')} -> ${newState.selfVideo ? t(locale, 'logSearchShared.legacy.on') : t(locale, 'logSearchShared.legacy.off')}`,
            );
        }
    } else {
        details.push(t(locale, 'logSearchShared.voice.changedUnknown'));
    }

    if (details.length === 1 && userId) {
        details.push(t(locale, 'logSearchShared.legacy.voiceChangedWithoutChannel'));
    } else if (details.length === 0) {
        details.push(t(locale, 'logSearchShared.legacy.noVoiceStateInfo'));
    }

    let thumbnailComponent: ThumbnailBuilder | undefined;
    if (userId) {
        try {
            const user = await interaction.client.users.fetch(userId);
            thumbnailComponent = new ThumbnailBuilder({
                media: {
                    url: user.displayAvatarURL({
                        forceStatic: false,
                        size: 64,
                    }),
                },
            });
        } catch {
            /* empty */
        }
    }

    return {
        eventSpecificsText: details.join('\n'),
        thumbnailComponent,
    };
}

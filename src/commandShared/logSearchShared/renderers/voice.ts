import {
    ThumbnailBuilder,
    type ChatInputCommandInteraction,
    type MessageComponentInteraction,
} from 'discord.js';
import type { JsonData, JsonValue } from '../../../types/json.js';
import { str } from '../formatters.js';
import { isJsonData } from '../types.js';

interface RenderVoiceStateUpdateEventParams {
    data: JsonData;
    interaction: ChatInputCommandInteraction | MessageComponentInteraction;
}

interface VoiceRenderResult {
    eventSpecificsText: string;
    thumbnailComponent?: ThumbnailBuilder;
}

function getJsonData(value: JsonValue | undefined): JsonData | undefined {
    return isJsonData(value) ? value : undefined;
}

export async function renderEvent(
    params: RenderVoiceStateUpdateEventParams,
): Promise<VoiceRenderResult> {
    const { data, interaction } = params;
    const details: string[] = [];
    const oldState = getJsonData(data.oldState);
    const newState = getJsonData(data.newState) ?? getJsonData(data.state);
    const member =
        getJsonData(data.member) ?? getJsonData(newState?.member) ?? getJsonData(oldState?.member);
    const memberUser = getJsonData(member?.user);

    const userId = str(newState?.id ?? oldState?.id ?? member?.id);
    const userTag = str(memberUser?.tag) || str(data.userTag);

    if (userId) {
        details.push(`**사용자:** ${userTag || `<@${userId}>`} (${userId})`);
    }

    const oldChannelId = str(oldState?.channelId);
    const newChannelId = str(newState?.channelId);

    if (oldChannelId && !newChannelId) {
        details.push(`음성 채널 <#${oldChannelId}> 나감`);
    } else if (!oldChannelId && newChannelId) {
        details.push(`음성 채널 <#${newChannelId}> 참가`);
    } else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
        details.push(`음성 채널 <#${oldChannelId}> -> <#${newChannelId}> 이동`);
    } else if (!oldChannelId && !newChannelId && oldState && newState) {
        if (oldState.serverMute !== newState.serverMute) {
            details.push(
                `**서버 음소거:** ${oldState.serverMute ? '설정' : '해제'} -> ${newState.serverMute ? '설정' : '해제'}`,
            );
        }
        if (oldState.serverDeaf !== newState.serverDeaf) {
            details.push(
                `**서버 헤드셋음소거:** ${oldState.serverDeaf ? '설정' : '해제'} -> ${newState.serverDeaf ? '설정' : '해제'}`,
            );
        }
        if (oldState.selfMute !== newState.selfMute) {
            details.push(
                `**개인 음소거:** ${oldState.selfMute ? '설정' : '해제'} -> ${newState.selfMute ? '설정' : '해제'}`,
            );
        }
        if (oldState.selfDeaf !== newState.selfDeaf) {
            details.push(
                `**개인 헤드셋음소거:** ${oldState.selfDeaf ? '설정' : '해제'} -> ${newState.selfDeaf ? '설정' : '해제'}`,
            );
        }
        if (oldState.streaming !== newState.streaming) {
            details.push(
                `**스트리밍:** ${oldState.streaming ? '시작' : '중지'} -> ${newState.streaming ? '시작' : '중지'}`,
            );
        }
        if (oldState.selfVideo !== newState.selfVideo) {
            details.push(
                `**카메라:** ${oldState.selfVideo ? '켬' : '끔'} -> ${newState.selfVideo ? '켬' : '끔'}`,
            );
        }
    } else {
        details.push('음성 상태 변경 (세부사항 불명확)');
    }

    if (details.length === 1 && userId) {
        details.push('음성 상태 변경됨 (채널 변경 외)');
    } else if (details.length === 0) {
        details.push('음성 상태 업데이트 정보 없음');
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

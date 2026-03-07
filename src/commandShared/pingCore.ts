import {
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder,
    WebSocketShardStatus,
} from 'discord.js';

import { t } from '../i18n/index.js';

import type { SupportedLocale } from '../types/i18n.js';
import type { PingMetrics } from '../types/ping.js';
import type { Client } from 'discord.js';

/**
 * 핑 측정 시작 시 표시할 임시 응답 payload를 생성합니다.
 */
export function createPendingPingReply(locale: SupportedLocale) {
    return {
        flags: MessageFlags.IsComponentsV2 as const,
        components: [new TextDisplayBuilder().setContent(t(locale, 'ping.pending'))],
    };
}

/**
 * 측정된 지연 시간 정보를 사용자 표시용 컴포넌트로 변환합니다.
 */
export function createPingResultReply(metrics: PingMetrics, locale: SupportedLocale) {
    return {
        components: [
            new TextDisplayBuilder().setContent(
                t(locale, 'ping.latency', { latency: metrics.latency }),
            ),
            new SeparatorBuilder(),
            new TextDisplayBuilder().setContent(
                t(locale, 'ping.apiLatency', { apiLatency: metrics.apiLatency }),
            ),
            new SeparatorBuilder(),
            new TextDisplayBuilder().setContent(
                t(locale, 'ping.wsStatus', { wsStatus: metrics.wsStatusString }),
            ),
        ],
    };
}

/**
 * 메시지/WS 핑 값을 읽어 핑 명령 응답용 메트릭을 계산합니다.
 */
export async function resolvePingMetrics(
    createdTimestamp: number,
    replyCreatedTimestamp: number,
    client: Client,
): Promise<PingMetrics> {
    const latency = replyCreatedTimestamp - createdTimestamp;

    let apiLatency = Math.round(client.ws.ping);
    let wsStatus = client.ws.status;

    if (apiLatency === -1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        apiLatency = Math.round(client.ws.ping);
        wsStatus = client.ws.status;
    }

    return {
        latency,
        apiLatency,
        wsStatusString: WebSocketShardStatus[wsStatus] || wsStatus.toString(),
    };
}

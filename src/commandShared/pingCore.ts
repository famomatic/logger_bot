import {
    Client,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder,
    WebSocketShardStatus,
} from 'discord.js';
import type { PingMetrics } from '../types/ping.js';

export type { PingMetrics } from '../types/ping.js';

export function createPendingPingReply() {
    return {
        flags: MessageFlags.IsComponentsV2 as const,
        components: [new TextDisplayBuilder().setContent('🏓 퐁! 지연시간 계산중...')],
    };
}

export function createPingResultReply(metrics: PingMetrics) {
    return {
        components: [
            new TextDisplayBuilder().setContent(`🏓 퐁! 현재 봇 지연시간: ${metrics.latency}ms`),
            new SeparatorBuilder(),
            new TextDisplayBuilder().setContent(`API 지연시간: ${metrics.apiLatency}ms`),
            new SeparatorBuilder(),
            new TextDisplayBuilder().setContent(`웹소켓 상태: ${metrics.wsStatusString}`),
        ],
    };
}

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

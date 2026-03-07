import { Events, AuditLogEvent } from 'discord.js';

import { fetchAuditLogsCached } from '../utils/auditLogCache.js';
import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { VoiceState, Guild, AuditLogChange, User } from 'discord.js';

async function logVoiceEvent(
    eventType: string,
    guild: Guild,
    user: User,
    channelId: string | null,
    timestamp: Date,
    data: object,
    executorId?: string | null,
) {
    const guildId = guild.id;
    const userId = user.id;
    // 서버 뮤트/데프의 경우 executorId가 user_id, 대상 유저가 target_id
    // 그 외에는 사용자 자신이 user_id 및 target_id
    const dbUserId = executorId ?? userId;
    // 기존 UNIQUE 제약 조건 (guild_id, event_type, target_id) 때문에
    // 동일 사용자에 대한 중복 이벤트가 기록되지 않는 문제가 있었다.
    // 각 음성 이벤트가 고유하게 기록되도록 타겟 ID에 타임스탬프를 조합한다.
    const dbTargetId = `${userId}-${timestamp.getTime().toString(36)}`;
    const combinedData = { userId: userId, userTag: user.tag, ...data }; // 기본 유저 정보 추가

    try {
        const logged = await logEvent(
            eventType,
            guildId,
            dbUserId, // user_id: 실행자 (없으면 본인)
            channelId, // channel_id: 현재 또는 이전 채널
            dbTargetId, // target_id: 사용자별 고유 이벤트 ID
            combinedData, // data: 이벤트 관련 정보 (user 정보 포함)
            timestamp,
        );
        if (logged) {
            logger.debug(
                `Logged ${eventType} event for user ${user.tag} (${userId}) in guild ${guildId}`,
            );
        } else {
            logger.debug(
                `Skipped logging duplicate ${eventType} for user ${userId} (${user.tag}) in channel ${channelId ?? 'unknown'}`,
            );
        }
    } catch (error) {
        logger.error(
            `Error occurred while trying to log ${eventType} event for user ${userId} in guild ${guildId}:`,
            error,
        );
    }
}

const event = {
    name: Events.VoiceStateUpdate,
    async execute(oldState: VoiceState, newState: VoiceState) {
        const guild = newState.guild; // or oldState.guild
        const user = newState.member?.user; // or oldState.member?.user

        // 사용자 정보가 없으면 처리 불가 (매우 드문 경우)
        if (!user) return;
        // 봇은 무시
        if (user.bot) return;

        const timestamp = new Date();
        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;
        const oldChannelName = oldState.channel?.name;
        const newChannelName = newState.channel?.name;

        // 1. 채널 변경 감지
        if (oldChannelId !== newChannelId) {
            if (!oldChannelId && newChannelId) {
                // 참가 (Join)
                await logVoiceEvent('voiceChannelJoin', guild, user, newChannelId, timestamp, {
                    channelId: newChannelId,
                    channelName: newChannelName,
                });
            } else if (oldChannelId && !newChannelId) {
                // 퇴장 (Leave)
                await logVoiceEvent('voiceChannelLeave', guild, user, oldChannelId, timestamp, {
                    channelId: oldChannelId,
                    channelName: oldChannelName,
                });
            } else if (oldChannelId && newChannelId) {
                // 이동 (Move)
                await logVoiceEvent('voiceChannelMove', guild, user, newChannelId, timestamp, {
                    oldChannelId: oldChannelId,
                    oldChannelName: oldChannelName,
                    newChannelId: newChannelId,
                    newChannelName: newChannelName,
                });
            }
        }

        // 채널에 있는 동안 발생하는 상태 변경 (newState.channelId가 있어야 함)
        const currentChannelId = newState.channelId;
        if (currentChannelId) {
            // 2. 서버 뮤트/데프 변경 감지
            if (
                oldState.serverMute !== newState.serverMute ||
                oldState.serverDeaf !== newState.serverDeaf
            ) {
                const isMuteChange = oldState.serverMute !== newState.serverMute;
                const eventType = isMuteChange
                    ? 'voiceStateUpdateServerMute'
                    : 'voiceStateUpdateServerDeaf';
                const changeKey = isMuteChange ? 'mute' : 'deaf';
                const oldStatus = isMuteChange ? oldState.serverMute : oldState.serverDeaf;
                const newStatus = isMuteChange ? newState.serverMute : newState.serverDeaf;

                let executorId: string | null = null;
                try {
                    const fetchedLogs = await fetchAuditLogsCached(guild, {
                        limit: 5,
                        type: AuditLogEvent.MemberUpdate, // 24
                        ttlMs: 2_000,
                    });
                    const stateLog = fetchedLogs.entries.find(
                        (entry) =>
                            entry.targetId === user.id &&
                            entry.changes.some((c: AuditLogChange) => c.key === changeKey) &&
                            Math.abs(Date.now() - entry.createdTimestamp) < 5000,
                    );
                    if (stateLog) {
                        executorId = stateLog.executor?.id ?? null;
                    }
                } catch (error) {
                    logger.error(
                        `Failed to fetch Audit Logs for ${eventType} in guild ${guild.id}:`,
                        error,
                    );
                }

                await logVoiceEvent(
                    eventType,
                    guild,
                    user,
                    currentChannelId,
                    timestamp,
                    {
                        channelId: currentChannelId,
                        channelName: newChannelName,
                        change: changeKey,
                        oldStatus: oldStatus,
                        newStatus: newStatus,
                        executorUserId: executorId, // 이 ID가 로그의 user_id로 들어감
                    },
                    executorId, // 실행자를 user_id로 전달
                );
            }

            // 3. 셀프 뮤트/데프 변경 감지
            if (oldState.selfMute !== newState.selfMute) {
                await logVoiceEvent(
                    'voiceStateUpdateSelfMute',
                    guild,
                    user,
                    currentChannelId,
                    timestamp,
                    {
                        channelId: currentChannelId,
                        channelName: newChannelName,
                        muted: newState.selfMute,
                    },
                );
            }
            if (oldState.selfDeaf !== newState.selfDeaf) {
                await logVoiceEvent(
                    'voiceStateUpdateSelfDeaf',
                    guild,
                    user,
                    currentChannelId,
                    timestamp,
                    {
                        channelId: currentChannelId,
                        channelName: newChannelName,
                        deafened: newState.selfDeaf,
                    },
                );
            }

            // 4. 스트리밍 상태 변경 감지
            if (oldState.streaming !== newState.streaming) {
                await logVoiceEvent(
                    'voiceStateUpdateStreaming',
                    guild,
                    user,
                    currentChannelId,
                    timestamp,
                    {
                        channelId: currentChannelId,
                        channelName: newChannelName,
                        streaming: newState.streaming,
                    },
                );
            }

            // 5. 비디오 상태 변경 감지
            if (oldState.selfVideo !== newState.selfVideo) {
                await logVoiceEvent(
                    'voiceStateUpdateVideo',
                    guild,
                    user,
                    currentChannelId,
                    timestamp,
                    {
                        channelId: currentChannelId,
                        channelName: newChannelName,
                        video: newState.selfVideo,
                    },
                );
            }
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export { event };

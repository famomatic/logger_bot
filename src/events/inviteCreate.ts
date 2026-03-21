import { Events, AuditLogEvent } from 'discord.js';

import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { Invite, AuditLogChange } from 'discord.js';

const event = {
    name: Events.InviteCreate,
    async execute(invite: Invite) {
        // 길드 정보나 생성자 정보가 없으면 처리 불가 (이론상 발생하기 어려움)
        if (!invite.guild || !invite.inviter || !invite.channel) return;

        const eventType = 'inviteCreate';
        const guildId = invite.guild.id;
        // Audit Log 조회를 위해 실제 Guild 객체 가져오기
        const guild = invite.client.guilds.cache.get(guildId);
        if (!guild) {
            logger.warn(
                `Could not find guild ${guildId} in cache for invite ${invite.code}. Cannot fetch audit logs.`,
            );
        }

        const channelId = invite.channel.id;
        const inviterId = invite.inviter.id;
        const inviteCode = invite.code;
        const timestamp = invite.createdTimestamp ? new Date(invite.createdTimestamp) : new Date();
        let executorId: string | null = null;

        if (guild) {
            try {
                const fetchedLogs = await guild.fetchAuditLogs({
                    limit: 5,
                    type: AuditLogEvent.InviteCreate, // 40
                });
                // 코드가 일치하는 가장 최근 InviteCreate 로그 찾기
                const createLog = fetchedLogs.entries.find((entry) =>
                    entry.changes.some(
                        (c: AuditLogChange) => c.key === 'code' && c.new === inviteCode,
                    ),
                );

                if (createLog && Math.abs(Date.now() - createLog.createdTimestamp) < 5000) {
                    executorId = createLog.executor?.id ?? null;
                    // timestamp = createLog.createdAt;
                } else {
                    // Audit Log 못 찾으면 inviter가 executor로 간주
                    logger.warn(
                        `Could not confirm executor for ${eventType} (code ${inviteCode}) in guild ${guildId} via Audit Log. Executor might be missing.`,
                    );
                }
            } catch (error) {
                // executorId = inviterId; // 에러 시에도 inviter를 executor로 간주
                logger.error(
                    `Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`,
                    error,
                );
            }
        }

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            inviteCode: inviteCode,
            channelId: channelId,
            channelName: invite.channel.name,
            inviterId: inviterId,
            inviterTag: invite.inviter.tag,
            maxUses: invite.maxUses,
            maxAge: invite.maxAge,
            temporary: invite.temporary,
            createdAt: timestamp.toISOString(),
            expiresAt: invite.expiresTimestamp
                ? new Date(invite.expiresTimestamp).toISOString()
                : null,
            uses: invite.uses,
            executorUserId: executorId,
        };

        try {
            await logEvent(
                eventType,
                guildId,
                inviterId,
                channelId,
                channelId,
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} event for code ${inviteCode} in channel ${channelId} of guild ${guildId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} event for code ${inviteCode}:`,
                error,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export { event };

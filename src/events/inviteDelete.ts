import { Events, Invite, AuditLogEvent, AuditLogChange } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

const event = {
  name: Events.InviteDelete,
  async execute(invite: Invite) {
    // 길드 정보나 채널 정보가 없으면 처리 불가
    if (!invite.guild || !invite.channel) return;

    const eventType = 'inviteDelete';
    const guildId = invite.guild.id;
    const guild = invite.client.guilds.cache.get(guildId);
    if (!guild) {
        logger.warn(`Could not find guild ${guildId} in cache for deleted invite ${invite.code}. Cannot fetch audit logs.`);
        // Audit Log 없이도 로깅은 시도
    }

    const channelId = invite.channel.id;
    const inviteCode = invite.code;
    const timestamp = new Date(); // 삭제 이벤트 발생 시각
    let executorId: string | null = null;

    // Audit Log 조회 시도 (Guild 객체가 있을 때만)
    if (guild) {
        try {
            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 5,
                type: AuditLogEvent.InviteDelete, // 42
            });
            // 코드가 일치하는 가장 최근 InviteDelete 로그 찾기
            const deleteLog = fetchedLogs.entries.find(entry =>
                entry.changes?.some((c: AuditLogChange) => c.key === 'code' && c.old === inviteCode) // 이전 값(old)과 비교
            );

            if (deleteLog && Math.abs(Date.now() - deleteLog.createdTimestamp) < 5000) {
                executorId = deleteLog.executor?.id ?? null;
                // timestamp = deleteLog.createdAt;
            } else {
                // 만료 또는 Audit Log 확인 불가
                logger.warn(`Could not confirm executor for ${eventType} (code ${inviteCode}) in guild ${guildId} via Audit Log. Invite might have expired.`);
            }
        } catch (error) {
            logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
        }
    }

    // 데이터베이스에 저장할 JSON 데이터
    const dataToStore = {
      deletedInviteCode: inviteCode,
      channelId: channelId,
      channelName: invite.channel.name,
      // inviter 정보는 삭제 시점에 없을 수 있음
      // inviterId: invite.inviter?.id,
      // inviterTag: invite.inviter?.tag,
      executorUserId: executorId, // 삭제 실행자 (있을 경우)
      // 생성 시각, 만료 시각 등 invite 객체에 남아있는 정보 추가 가능
      // createdAt: invite.createdTimestamp ? new Date(invite.createdTimestamp).toISOString() : null,
      // uses: invite.uses, // 삭제 시점의 사용 횟수
    };

    try {
      await logEvent(
        eventType,
        guildId,
        executorId,
        channelId,
        channelId,
        dataToStore,
        timestamp
      );
      logger.debug(`Logged ${eventType} event for code ${inviteCode} in channel ${channelId} of guild ${guildId}`);
    } catch (error) {
      logger.error(`Error occurred while trying to log ${eventType} event for code ${inviteCode}:`, error);
    }
  },
} as const;

export default event; 
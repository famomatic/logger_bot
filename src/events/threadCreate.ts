import { Events, ThreadChannel, AuditLogEvent, ChannelType } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

const event = {
  name: Events.ThreadCreate,
  async execute(thread: ThreadChannel, newlyCreated: boolean) {
    // newlyCreated가 false면 이미 존재하던 스레드에 봇이 접근한 경우일 수 있음
    if (!newlyCreated) {
        // logger.debug(`Bot gained access to existing thread ${thread.name} (${thread.id}), not logging as creation.`);
        return;
    }

    const eventType = 'threadCreate';
    const guild = thread.guild;
    const guildId = guild.id;
    const targetId = thread.id; // 생성된 스레드 ID
    const parentChannelId = thread.parentId;
    const ownerId = thread.ownerId; // 스레드 생성자 (메시지에서 시작된 경우 메시지 작성자)
    const timestamp = thread.createdAt ?? new Date();
    let executorId: string | null = null;

    try {
        const fetchedLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.ThreadCreate, // 110
        });
        const createLog = fetchedLogs.entries.first();
        // Audit Log의 target이 생성된 스레드와 일치하는지 확인
        if (createLog && createLog.target?.id === targetId && Math.abs(Date.now() - createLog.createdTimestamp) < 5000) {
            executorId = createLog.executor?.id ?? null;
        } else {
            executorId = ownerId; // Audit Log 없으면 생성자를 실행자로 간주
            logger.warn(`Could not confirm executor for ${eventType} (thread ${targetId}) in guild ${guildId} via Audit Log. Assuming owner is executor.`);
        }
    } catch (error) {
        executorId = ownerId; // 에러 시에도 생성자를 실행자로 간주
        logger.error(`Failed to fetch Audit Logs for ${eventType} in guild ${guildId}:`, error);
    }

    const dataToStore = {
      threadId: targetId,
      threadName: thread.name,
      parentId: parentChannelId,
      parentName: thread.parent?.name,
      ownerId: ownerId,
      type: ChannelType[thread.type], // PublicThread, PrivateThread 등
      archived: thread.archived,
      autoArchiveDuration: thread.autoArchiveDuration,
      rateLimitPerUser: thread.rateLimitPerUser,
      executorUserId: executorId,
    };

    try {
      await logEvent(
        eventType,
        guildId,
        executorId,
        parentChannelId,
        targetId,
        dataToStore,
        timestamp
      );
      logger.debug(`Logged ${eventType} event for thread ${thread.name} (${targetId}) in guild ${guildId}`);
    } catch (error) {
      logger.error(`Error occurred while trying to log ${eventType} event for thread ${targetId}:`, error);
    }
  },
} as const;

export default event; 
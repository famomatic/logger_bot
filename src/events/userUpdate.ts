import { Events, User, PartialUser } from 'discord.js';
import { logger } from '../utils/logger.js';
// import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js'; // Logging removed for this event

const event = {
    name: Events.UserUpdate,
    execute(oldUser: User | PartialUser, newUser: User) {
        // oldUser가 Partial일 수 있으므로, 변경 감지는 newUser 기준으로 함
        const targetId = newUser.id;
        // const timestamp = new Date(); // Not needed if not logging
        let changesDetected = false;
        // const changes: { [key: string]: { old: any; new: any } } = {}; // Not needed

        // --- 변경 사항 감지 --- (oldUser 정보가 있을 때만 비교 가능)
        if (oldUser instanceof User) {
            // Username 변경
            if (oldUser.username !== newUser.username) changesDetected = true;
            // Discriminator 변경
            if (oldUser.discriminator !== newUser.discriminator) changesDetected = true;
            // Avatar 변경
            if (oldUser.avatar !== newUser.avatar) changesDetected = true;
            // TODO: Banner, Accent Color 등 다른 User 필드 변경 감지 추가 가능
        } else {
            logger.warn(
                `Received ${Events.UserUpdate} for user ${targetId} but oldUser is partial, cannot detect changes accurately. Skipping.`,
            );
            return;
        }

        // 변경 사항이 없으면 아무것도 안 함
        if (!changesDetected) {
            return;
        }

        // 전역 UserUpdate 이벤트는 로깅하지 않음.
        // 서버 프로필 변경(닉네임 등)은 GuildMemberUpdate에서 처리.
        // logger.debug(`Detected userUpdate for ${newUser.tag} (${targetId}), but global user updates are not logged.`);

        /* // 로깅 로직 제거
    const eventType = 'userUpdate';
    const globalGuildId = '__GLOBAL__';

    const dataToStore = {
      targetUserId: targetId,
      targetUserTag: newUser.tag,
      changes: changes,
    };

    try {
      await logEvent(
        eventType,
        globalGuildId,
        null,
        null,
        targetId,
        dataToStore,
        timestamp
      );
      logger.debug(`Logged ${eventType} for user ${newUser.tag} (${targetId}) ...`);
    } catch (error) {
      logger.error(`Error occurred while trying to log ${eventType} for user ${targetId}:`, error);
    }
    */
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export default event;

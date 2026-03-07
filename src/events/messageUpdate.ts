import { Events } from 'discord.js';

import { logEventIfAuthorized as logEvent } from '../utils/eventLog.js';
import { logger } from '../utils/logger.js';

import type { Message, PartialMessage } from 'discord.js';

const event = {
    name: Events.MessageUpdate,
    async execute(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
        // 메시지가 Partial이거나 내용 변경이 없거나 봇이 작성한 경우 무시
        if (oldMessage.partial || newMessage.partial) {
            // Partial 메시지는 내용을 비교할 수 없음
            // 필요하다면 newMessage.fetch()를 시도해 볼 수 있음
            return;
        }
        if (oldMessage.content === newMessage.content) {
            // 임베드 로딩 등 내용 외 변경은 무시
            return;
        }
        if (newMessage.author.bot) {
            // 봇 메시지 수정은 무시
            return;
        }
        // DM 메시지는 무시
        if (!newMessage.guild) {
            return;
        }

        const eventType = 'messageUpdate';
        const timestamp = newMessage.editedTimestamp
            ? new Date(newMessage.editedTimestamp)
            : new Date(); // Date 객체로 변환
        const channelId = newMessage.channel.id;
        const messageId = newMessage.id;
        const guildId = newMessage.guild.id;
        const author = newMessage.author;
        const authorId = author.id;
        const oldContent = oldMessage.content;
        const newContent = newMessage.content;

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            messageId: messageId,
            channelId: channelId,
            authorId: authorId,
            authorTag: author.tag,
            oldContent: oldContent,
            newContent: newContent,
            messageUrl: newMessage.url, // 메시지 바로가기 링크
        };

        try {
            await logEvent(
                eventType,
                guildId,
                authorId, // user_id: 메시지 작성자
                channelId,
                messageId, // target_id: 수정된 메시지 ID
                dataToStore,
                timestamp, // 이제 항상 Date 객체
            );
            logger.debug(
                `Logged ${eventType} for message ${messageId} by ${author.tag} in channel ${channelId}`,
            );
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} for message ${messageId}:`,
                error,
            );
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export { event };

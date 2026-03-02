import { Events, MessageReaction, User, PartialUser, PartialMessageReaction } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

const event = {
    name: Events.MessageReactionAdd,
    async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
        logger.debug(
            `Received ${Events.MessageReactionAdd} event for message ${reaction.message.id}`,
        ); // Function entry

        // Partial 정보 처리 시도
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                logger.error('Failed to fetch partial reaction:', error);
                return; // Partial 리액션 정보 가져오기 실패 시 로깅 불가
            }
        }
        if (user.partial) {
            try {
                await user.fetch();
            } catch (error) {
                logger.error('Failed to fetch partial user reacting:', error);
                return; // Partial 사용자 정보 가져오기 실패 시 로깅 불가
            }
        }

        // 봇이 반응하거나 DM에서 발생한 경우 무시
        if (user.bot || !reaction.message.guild) {
            // logger.debug('Ignoring bot or DM reaction.'); // Removed redundant log
            return;
        }

        const eventType = 'messageReactionAdd';
        const guildId = reaction.message.guild.id;
        const channelId = reaction.message.channel.id;
        const messageId = reaction.message.id;
        const reactorUserId = user.id; // 반응을 추가한 사용자
        const messageAuthorId = reaction.message.author?.id ?? null; // 메시지 작성자
        const timestamp = new Date();
        const emoji = reaction.emoji;

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore = {
            messageId: messageId,
            channelId: channelId,
            messageAuthorId: messageAuthorId,
            reactorUserId: reactorUserId,
            reactorUserTag: user.tag,
            emojiName: emoji.name,
            emojiId: emoji.id,
            emojiAnimated: emoji.animated,
            messageUrl: reaction.message.url,
        };
        // logger.debug('Prepared dataToStore object:', dataToStore); // Removed redundant log

        try {
            // logger.debug(`Attempting to log event ${eventType} to database...`); // Removed redundant log
            await logEvent(
                eventType,
                guildId,
                reactorUserId, // user_id: 반응 추가한 사용자
                channelId, // channel_id: 메시지가 있는 채널
                messageId, // target_id: 반응이 추가된 메시지
                dataToStore,
                timestamp,
            );
            logger.debug(
                `Logged ${eventType} by ${user.tag} on message ${messageId} in guild ${guildId}`,
            ); // Keep success log
        } catch (error) {
            logger.error(
                `Error occurred while trying to log ${eventType} for message ${messageId}:`,
                error,
            ); // Keep error log
        }
    },
} as const;

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export default event;

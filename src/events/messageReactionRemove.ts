import { Events, MessageReaction, User, PartialUser, PartialMessageReaction } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';

const event = {
  name: Events.MessageReactionRemove,
  async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
    logger.debug(`Received ${Events.MessageReactionRemove} event for message ${reaction.message.id}`); // Function entry

    // Partial 정보 처리 시도 (Add와 동일)
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        logger.error('Failed to fetch partial reaction:', error);
        return;
      }
    }
    if (user.partial) {
      try {
        await user.fetch();
      } catch (error) {
        logger.error('Failed to fetch partial user reacting:', error);
        return;
      }
    }

    // 봇이 반응하거나 DM에서 발생한 경우 무시
    if (user.bot || !reaction.message.guild) {
        // logger.debug('Ignoring bot or DM reaction.');
        return;
    }

    const eventType = 'messageReactionRemove';
    const guildId = reaction.message.guild.id;
    const channelId = reaction.message.channel.id;
    const messageId = reaction.message.id;
    const removerUserId = user.id; // 반응을 제거한 사용자
    const messageAuthorId = reaction.message.author?.id ?? null; // 메시지 작성자
    const timestamp = new Date();
    const emoji = reaction.emoji;

    // 데이터베이스에 저장할 JSON 데이터
    const dataToStore = {
      messageId: messageId,
      channelId: channelId,
      messageAuthorId: messageAuthorId,
      removerUserId: removerUserId,
      removerUserTag: user.tag,
      emojiName: emoji.name,
      emojiId: emoji.id,
      emojiAnimated: emoji.animated,
      messageUrl: reaction.message.url,
    };

    try {
      await logEvent(
        eventType,
        guildId,
        removerUserId, // user_id: 반응 제거한 사용자
        channelId,     // channel_id: 메시지가 있는 채널
        messageId,     // target_id: 반응이 제거된 메시지
        dataToStore,
        timestamp
      );
      logger.debug(`Logged ${eventType} by ${user.tag} on message ${messageId} in guild ${guildId}`); // Keep success log
    } catch (error) {
      logger.error(`Error occurred while trying to log ${eventType} for message ${messageId}:`, error); // Keep error log
    }
  },
} as const;

export default event; 
import { Events, Client, ActivityType } from 'discord.js';
import { logger } from '../utils/logger.js';

const event = {
  name: Events.ClientReady, // discord.js에서 제공하는 이벤트 이름 상수 사용
  once: true, // 이 이벤트는 한 번만 실행됩니다.
  execute(client: Client) {
    if (!client.user) {
      logger.error('Client user is not available on ready event.');
      return;
    }
    logger.success(`Ready! Logged in as ${client.user.tag} (${client.user.id})`);
    logger.info(`Bot is serving ${client.guilds.cache.size} guilds.`);

    const user = client.user;
    if (!user) {
      logger.error('Client user is not available on ready event.');
      return;
    }

    const activities = [
      { name: '감시', type: ActivityType.Playing },
      { name: '로그', type: ActivityType.Watching },
      { name: '모든 이벤트', type: ActivityType.Listening },
    ];

    user.setStatus('dnd');
    user.setActivity('재시작', { type: ActivityType.Playing })

    let i = 0;
    setInterval(() => {
      const activity = activities[i++ % activities.length];
      user.setActivity(activity.name, { type: activity.type });
      user.setStatus('dnd');
    }, 600000);
  },
};

export default event; 
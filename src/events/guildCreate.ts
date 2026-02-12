import { Events, Guild } from 'discord.js';
import { logger } from '../utils/logger.js';
import { isGuildAuthorized } from '../db/database.js';
import { leaveUnauthorizedGuild } from '../utils/guildAuthorization.js';

const event = {
  name: Events.GuildCreate,
  async execute(guild: Guild) {
    const guildId = guild.id;
    if (isGuildAuthorized(guildId)) {
      logger.info(`Joined authorized guild ${guild.name} (${guildId})`);
      return;
    }
    logger.warn(`Joined unauthorized guild ${guild.name} (${guildId})`);
    await leaveUnauthorizedGuild(guild);
  },
} as const;

export default event;

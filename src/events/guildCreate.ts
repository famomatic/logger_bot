import { Events } from 'discord.js';

import { isGuildAuthorized } from '../db/database.js';
import { leaveUnauthorizedGuild } from '../utils/guildAuthorization.js';
import { logger } from '../utils/logger.js';

import type { Guild } from 'discord.js';

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

/**
 * 이벤트 로더가 참조하는 기본 export 이벤트 핸들러입니다.
 */
export { event };

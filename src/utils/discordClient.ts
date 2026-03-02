import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { logger } from './logger.js';

/**
 * 애플리케이션 전역에서 사용하는 Discord.js 클라이언트 인스턴스입니다.
 */
export const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildExpressions,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

/**
 * Discord 클라이언트를 종료해 소켓 연결과 리소스를 해제합니다.
 */
export function destroyDiscordClient() {
    logger.info('Destroying Discord client...');
    void discordClient.destroy();
    logger.info('Discord client destroyed.');
}

/**
 * 전역 Discord 클라이언트 기본 export 입니다.
 */
export default discordClient;

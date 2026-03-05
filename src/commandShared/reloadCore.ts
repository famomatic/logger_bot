import { Client, Events } from 'discord.js';
import dotenv from 'dotenv';
import { reloadConfig } from '../config/config.js';
import { restartLogQueue } from '../queue/logEventQueue.js';
import { loadLegacyCommands, unloadLegacyCommands } from '../utils/loadLegacyCommands.js';
import { loadSlashCommands, unloadSlashCommands } from '../utils/loadSlashCommands.js';
import { loadEvents, unloadEvents } from '../utils/loadEvents.js';
import { logger } from '../utils/logger.js';

/**
 * 설정/명령어/이벤트/큐를 순차 재적재해 런타임 상태를 갱신합니다.
 */
export async function executeReload(client: Client): Promise<void> {
    dotenv.config({ override: true });
    reloadConfig();

    unloadLegacyCommands(client);
    await loadLegacyCommands(client);
    unloadSlashCommands(client);
    await loadSlashCommands(client);
    unloadEvents(client);
    await loadEvents(client);
    await restartLogQueue();

    client.on(Events.InteractionCreate, (interaction) => {
        void (async () => {
            if (!interaction.isChatInputCommand()) return;
            const cmd = client.commands?.get(interaction.commandName);
            if (!cmd) return;
            try {
                await cmd.execute(interaction, client);
            } catch (err) {
                logger.error(`Error executing command ${interaction.commandName}:`, err);
            }
        })();
    });
}

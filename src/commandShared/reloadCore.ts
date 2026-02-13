import { Client, Events } from 'discord.js';
import dotenv from 'dotenv';
import { config, reloadConfig } from '../config/config.js';
import { restartLogQueue } from '../queue/logEventQueue.js';
import { loadLegacyCommands, unloadLegacyCommands } from '../utils/loadLegacyCommands.js';
import { loadSlashCommands, unloadSlashCommands } from '../utils/loadSlashCommands.js';
import { loadEvents, unloadEvents } from '../utils/loadEvents.js';
import { logger } from '../utils/logger.js';

export function canRunReload(userId: string, isAdmin: boolean): boolean {
    const devLevel = config.getDevLevel(userId);
    return devLevel >= 3 || isAdmin;
}

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

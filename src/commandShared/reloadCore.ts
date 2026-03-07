import dotenv from 'dotenv';

import { reloadConfig } from '../config/config.js';
import { restartLogQueue } from '../queue/logEventQueue.js';
import { loadEvents, unloadEvents } from '../utils/loadEvents.js';
import { loadLegacyCommands, unloadLegacyCommands } from '../utils/loadLegacyCommands.js';
import { loadSlashCommands, unloadSlashCommands } from '../utils/loadSlashCommands.js';

import type { Client } from 'discord.js';

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
}

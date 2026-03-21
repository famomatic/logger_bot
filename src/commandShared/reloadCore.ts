import dotenv from 'dotenv';

import { reloadConfig } from '../config/config.js';
import { restartLogQueue } from '../queue/logEventQueue.js';
import { loadEvents, unloadEvents } from '../utils/loadEvents.js';
import { loadLegacyCommands, unloadLegacyCommands } from '../utils/loadLegacyCommands.js';
import { loadSlashCommands, unloadSlashCommands } from '../utils/loadSlashCommands.js';

import type { Client } from 'discord.js';

export interface ReloadResult {
    warnings: string[];
}

/**
 * 명령어/이벤트 모듈을 순차 재적재해 런타임 라우팅 상태를 갱신합니다.
 * 설정/큐/DB 연결은 재시작 없이 변경하지 않습니다.
 */
export async function executeReload(client: Client): Promise<ReloadResult> {
    dotenv.config({ override: true });
    reloadConfig();

    unloadLegacyCommands(client);
    await loadLegacyCommands(client);
    unloadSlashCommands(client);
    await loadSlashCommands(client);
    unloadEvents(client);
    await loadEvents(client);
    await restartLogQueue();

    return {
        warnings: [
            'Database pool and storage provider instances are not re-created by /reload. Restart process for DB/storage credential or backend changes.',
        ],
    };
}

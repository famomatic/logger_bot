import { loadEvents, unloadEvents } from '../utils/loadEvents.js';
import { loadLegacyCommands, unloadLegacyCommands } from '../utils/loadLegacyCommands.js';
import { loadSlashCommands, unloadSlashCommands } from '../utils/loadSlashCommands.js';

import type { Client } from 'discord.js';

/**
 * 명령어/이벤트 모듈을 순차 재적재해 런타임 라우팅 상태를 갱신합니다.
 * 설정/큐/DB 연결은 재시작 없이 변경하지 않습니다.
 */
export async function executeReload(client: Client): Promise<void> {
    unloadLegacyCommands(client);
    await loadLegacyCommands(client);
    unloadSlashCommands(client);
    await loadSlashCommands(client);
    unloadEvents(client);
    await loadEvents(client);
}

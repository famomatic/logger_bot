import { Collection, Client } from 'discord.js';
import { logger } from './logger.js';
import type { LegacyCommand } from '../types/commands.js';
import { loadModulesFromDirectory, resolveRuntimeSubdirectory } from './moduleLoader.js';

function isLegacyCommand(value: unknown): value is LegacyCommand {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<LegacyCommand>;
    return typeof candidate.name === 'string' && typeof candidate.execute === 'function';
}

/**
 * dist의 레거시 커맨드 모듈을 로드해 클라이언트 캐시에 등록합니다.
 */
export async function loadLegacyCommands(client: Client): Promise<void> {
    const legacyCommands = new Collection<string, LegacyCommand>();
    client.legacyCommands = legacyCommands;
    const commandsPath = resolveRuntimeSubdirectory(import.meta.url, 'command_legacy');

    const result = await loadModulesFromDirectory<LegacyCommand>({
        directoryPath: commandsPath,
        onDiscoveredFiles: (totalFiles) => {
            logger.info(`Loading ${totalFiles} legacy commands...`);
        },
        resolveModule: (moduleExports) => {
            if (!moduleExports || typeof moduleExports !== 'object') {
                return null;
            }
            const command = (moduleExports as { command?: unknown }).command;
            return isLegacyCommand(command) ? command : null;
        },
        onModule: (command) => {
            legacyCommands.set(command.name, command);
            logger.debug(`Loaded legacy command: ${command.name}`);
        },
        onInvalidModule: ({ filePath }) => {
            logger.warn(`The command at ${filePath} is missing required properties.`);
        },
        onModuleLoadError: ({ filePath }, error) => {
            logger.error(`Error loading legacy command file ${filePath}:`, error);
        },
    });

    if (!result.directoryExists) {
        logger.warn(`Legacy command directory not found: ${commandsPath}`);
        return;
    }

    logger.success(`Successfully loaded ${result.loadedCount} legacy commands.`);
}
/**
 * 메모리에 적재된 레거시 커맨드 캐시를 초기화합니다.
 */
export function unloadLegacyCommands(client: Client): void {
    client.legacyCommands?.clear?.();
}

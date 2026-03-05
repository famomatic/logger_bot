import { Client, Collection, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { logger } from './logger.js';
import { config } from '../config/config.js';
import type { SlashCommand } from '../types/commands.js';
import { setSlashPermissionCatalog } from '../commandShared/slashPermission.js';
import { loadModulesFromDirectory, resolveRuntimeSubdirectory } from './moduleLoader.js';

function isSlashCommand(value: unknown): value is SlashCommand {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<SlashCommand> & {
        data?: { name?: unknown; toJSON?: unknown };
    };
    return (
        typeof candidate.execute === 'function' &&
        !!candidate.data &&
        typeof candidate.data.name === 'string' &&
        typeof candidate.data.toJSON === 'function'
    );
}

/**
 * dist의 슬래시 커맨드 모듈을 동적으로 로드하고 Discord에 등록합니다.
 */
export async function loadSlashCommands(client: Client): Promise<void> {
    const commands = new Collection<string, SlashCommand>();
    client.commands = commands;
    const commandsPath = resolveRuntimeSubdirectory(import.meta.url, 'command_slash');
    const commandDataToRegister: ReturnType<SlashCommandBuilder['toJSON']>[] = [];
    const loadedSlashCommands: SlashCommand[] = [];

    const result = await loadModulesFromDirectory<SlashCommand>({
        directoryPath: commandsPath,
        bustImportCache: true,
        onDiscoveredFiles: (totalFiles) => {
            logger.info(`Loading ${totalFiles} slash commands...`);
        },
        resolveModule: (moduleExports) => {
            if (!moduleExports || typeof moduleExports !== 'object') {
                return null;
            }
            const command = (moduleExports as { command?: unknown }).command;
            return isSlashCommand(command) ? command : null;
        },
        onModule: (command) => {
            commands.set(command.data.name, command);
            commandDataToRegister.push(command.data.toJSON());
            loadedSlashCommands.push(command);
            logger.debug(`Loaded slash command: /${command.data.name}`);
        },
        onInvalidModule: ({ filePath }) => {
            logger.warn(`The slash command at ${filePath} is missing required properties.`);
        },
        onModuleLoadError: ({ filePath }, error) => {
            logger.error(`Error loading slash command file ${filePath}:`, error);
        },
    });

    if (!result.directoryExists) {
        logger.warn(`Slash command directory not found: ${commandsPath}`);
        return;
    }

    setSlashPermissionCatalog(loadedSlashCommands);

    // --- 슬래시 커맨드 등록 (전역만) ---
    if (commandDataToRegister.length > 0) {
        // clientId 존재 확인
        if (!config.clientId || !config.discordBotToken) {
            logger.error(
                'clientId or discordBotToken missing in config. Cannot register slash commands.',
            );
            return;
        }
        const rest = new REST({ version: '10' }).setToken(config.discordBotToken);
        logger.info(
            `Registering ${commandDataToRegister.length} application (/) commands globally.`,
        );

        try {
            // 전역 등록 실행 (devGuildId 체크 제거)
            await rest.put(Routes.applicationCommands(config.clientId), {
                body: commandDataToRegister,
            });
            logger.success(
                `Successfully registered ${commandDataToRegister.length} application commands globally.`,
            );
        } catch (error) {
            logger.error('Error registering global application commands:', error);
        }
    } else {
        logger.info('No application commands found to register.');
    }
    // ---------------------------------

    logger.success(`Successfully loaded ${result.loadedCount} slash commands locally.`);
}
/**
 * 메모리에 적재된 슬래시 커맨드 캐시를 비웁니다.
 */
export function unloadSlashCommands(client: Client): void {
    client.commands?.clear?.();
    setSlashPermissionCatalog([]);
}

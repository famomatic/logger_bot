import fs from 'fs';
import path from 'path';
import { Client, Collection, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { fileURLToPath, URL } from 'url';
import { logger } from './logger.js';
import { config } from '../config/config.js';
import type { SlashCommand } from '../types/commands.js';
import { setSlashPermissionCatalog } from '../commandShared/slashPermission.js';

/**
 * dist의 슬래시 커맨드 모듈을 동적으로 로드하고 Discord에 등록합니다.
 */
export async function loadSlashCommands(client: Client): Promise<void> {
    client.commands = new Collection<string, SlashCommand>();
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const commandsPath = path.join(__dirname, '..', 'command_slash');
    const commandDataToRegister: ReturnType<SlashCommandBuilder['toJSON']>[] = [];
    const loadedSlashCommands: SlashCommand[] = [];

    try {
        if (!fs.existsSync(commandsPath) || !fs.lstatSync(commandsPath).isDirectory()) {
            logger.warn(`Slash command directory not found: ${commandsPath}`);
            return;
        }

        const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
        logger.info(`Loading ${commandFiles.length} slash commands...`);

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            try {
                const resolvedPath = path.resolve(filePath);
                // 고유 쿼리 파라미터 추가로 캐시 무효화
                const fileUrl = new URL(`file:///${resolvedPath.replace(/\\/g, '/')}`);
                fileUrl.searchParams.set('update', Date.now().toString());
                const commandModule = (await import(fileUrl.href)) as { command: SlashCommand };
                const command = commandModule.command;

                if (command?.data && typeof command.execute === 'function') {
                    client.commands.set(command.data.name, command);
                    commandDataToRegister.push(command.data.toJSON());
                    loadedSlashCommands.push(command);
                    logger.debug(`Loaded slash command: /${command.data.name}`);
                } else {
                    logger.warn(`The slash command at ${filePath} is missing required properties.`);
                }
            } catch (fileLoadError) {
                logger.error(`Error loading slash command file ${filePath}:`, fileLoadError);
            }
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

        logger.success(`Successfully loaded ${client.commands.size} slash commands locally.`);
    } catch (error) {
        logger.error('Error reading slash commands directory:', error);
    }
}
/**
 * 메모리에 적재된 슬래시 커맨드 캐시를 비웁니다.
 */
export function unloadSlashCommands(client: Client): void {
    client.commands?.clear?.();
    setSlashPermissionCatalog([]);
}

import fs from 'fs';
import path from 'path';
import { Collection, Client } from 'discord.js';
import { fileURLToPath, URL } from 'url';
import { logger } from './logger.js';
import type { LegacyCommand } from '../types/commands.js';

export async function loadLegacyCommands(client: Client): Promise<void> {
    client.legacyCommands = new Collection<string, LegacyCommand>();
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // 경로: 현재 파일(src/utils/) 기준 상위 폴더(src/)의 command_legacy
    const commandsPath = path.join(__dirname, '..', 'command_legacy');

    try {
        if (!fs.existsSync(commandsPath) || !fs.lstatSync(commandsPath).isDirectory()) {
            logger.warn(`Legacy command directory not found: ${commandsPath}`);
            return;
        }

        const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
        logger.info(`Loading ${commandFiles.length} legacy commands...`);

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            try {
                const resolvedPath = path.resolve(filePath);
                const fileUrl = new URL(`file:///${resolvedPath.replace(/\\/g, '/')}`);
                const commandModule = (await import(fileUrl.href)) as { command: LegacyCommand };
                const command = commandModule.command;

                if (command?.name && typeof command.execute === 'function') {
                    client.legacyCommands.set(command.name, command);
                    logger.debug(`Loaded legacy command: ${command.name}`);
                } else {
                    logger.warn(`The command at ${filePath} is missing required properties.`);
                }
            } catch (fileLoadError) {
                logger.error(`Error loading legacy command file ${filePath}:`, fileLoadError);
            }
        }
        logger.success(`Successfully loaded ${client.legacyCommands.size} legacy commands.`);
    } catch (error) {
        logger.error('Error reading legacy commands directory:', error);
    }
}
export function unloadLegacyCommands(client: Client): void {
    client.legacyCommands?.clear?.();
}

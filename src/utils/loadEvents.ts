import fs from 'fs';
import path from 'path';
import { Client, Collection, Events } from 'discord.js'; // 필요한 타입 추가
import { fileURLToPath, URL } from 'url';
import { logger } from './logger.js';
import type { LegacyCommand } from '../types/commands.js';
import type { EventHandler } from '../types/events.js';

export async function loadEvents(client: Client): Promise<void> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // 경로: 현재 파일(src/utils/) 기준 상위 폴더(src/)의 events
    const eventsPath = path.join(__dirname, '..', 'events');

    try {
        if (!fs.existsSync(eventsPath) || !fs.lstatSync(eventsPath).isDirectory()) {
            logger.warn(`Events directory not found: ${eventsPath}`);
            return;
        }

        const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));
        let loadedCount = 0;

        logger.info(`Loading ${eventFiles.length} events...`);

        for (const file of eventFiles) {
            const filePath = path.join(eventsPath, file);
            try {
                const resolvedPath = path.resolve(filePath);
                const fileUrl = new URL(`file:///${resolvedPath.replace(/\\/g, '/')}`);
                const eventModule = (await import(fileUrl.href)) as { default: EventHandler };
                const event = eventModule.default;

                if (event?.name && typeof event.execute === 'function') {
                    // InteractionCreate는 로더에서 등록하지 않음 (index.ts에서 직접 처리)
                    if (event.name === (Events.InteractionCreate as string)) {
                        logger.debug(
                            `Skipping dynamic loading for ${Events.InteractionCreate}, handled in index.ts.`,
                        );
                        continue;
                    }

                    const executeWrapper = async (...args: unknown[]) => {
                        try {
                            // messageCreate 특별 처리: legacyCommands 전달
                            if (event.name === (Events.MessageCreate as string)) {
                                const [message] = args;
                                await event.execute(
                                    message,
                                    client,
                                    client.legacyCommands ??
                                        new Collection<string, LegacyCommand>(),
                                );
                            } else {
                                await event.execute(...args, client);
                            }
                        } catch (error) {
                            logger.error(`Error executing event ${event.name}:`, error);
                        }
                    };

                    if (event.once) {
                        client.once(event.name, (...args: unknown[]) => {
                            void executeWrapper(...args);
                        });
                    } else {
                        client.on(event.name, (...args: unknown[]) => {
                            void executeWrapper(...args);
                        });
                    }

                    logger.debug(`Loaded event: ${event.name}`);
                    loadedCount++;
                } else {
                    logger.warn(`The event at ${filePath} is missing required properties.`);
                }
            } catch (fileLoadError: unknown) {
                const errMsg =
                    fileLoadError instanceof Error ? fileLoadError.message : String(fileLoadError);
                const errStack = fileLoadError instanceof Error ? fileLoadError.stack : undefined;
                logger.error(`Error loading event file ${filePath}:`, errMsg, errStack);
            }
        }
        logger.success(`Successfully loaded ${loadedCount} events dynamically.`);
    } catch (error) {
        logger.error('Error reading events directory:', error);
    }
}
export function unloadEvents(client: Client): void {
    client.removeAllListeners();
}

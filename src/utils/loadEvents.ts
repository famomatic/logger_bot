import { Collection, Events } from 'discord.js'; // 필요한 타입 추가

import { logger } from './logger.js';
import { loadModulesFromDirectory, resolveRuntimeSubdirectory } from './moduleLoader.js';

import type { LegacyCommand } from '../types/commands.js';
import type { EventHandler, RegisteredEventListener } from '../types/events.js';
import type { Client } from 'discord.js';

const registeredEventListeners = new WeakMap<Client, RegisteredEventListener[]>();

function isEventHandler(value: unknown): value is EventHandler {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<EventHandler>;
    return typeof candidate.name === 'string' && typeof candidate.execute === 'function';
}

/**
 * dist 이벤트 모듈을 동적으로 로드해 Discord 클라이언트에 바인딩합니다.
 */
export async function loadEvents(client: Client): Promise<void> {
    unloadEvents(client);
    const eventsPath = resolveRuntimeSubdirectory(import.meta.url, 'events');
    const loadedListeners: RegisteredEventListener[] = [];

    const result = await loadModulesFromDirectory<EventHandler>({
        directoryPath: eventsPath,
        onDiscoveredFiles: (totalFiles) => {
            logger.info(`Loading ${totalFiles} events...`);
        },
        resolveModule: (moduleExports) => {
            if (!moduleExports || typeof moduleExports !== 'object') {
                return null;
            }
            const event = (moduleExports as { event?: unknown; default?: unknown }).event;
            if (isEventHandler(event)) {
                return event;
            }

            const defaultEvent = (moduleExports as { default?: unknown }).default;
            return isEventHandler(defaultEvent) ? defaultEvent : null;
        },
        onModule: (event) => {
            // InteractionCreate는 로더에서 등록하지 않음 (index.ts에서 직접 처리)
            if (event.name === (Events.InteractionCreate as string)) {
                logger.debug(
                    `Skipping dynamic loading for ${Events.InteractionCreate}, handled in index.ts.`,
                );
                return;
            }

            /**
             * 이벤트 실행 중 예외를 공통 로깅 처리하는 래퍼 함수입니다.
             */
            const executeWrapper = async (...args: unknown[]) => {
                try {
                    // messageCreate 특별 처리: legacyCommands 전달
                    if (event.name === (Events.MessageCreate as string)) {
                        const [message] = args;
                        await event.execute(
                            message,
                            client,
                            client.legacyCommands ?? new Collection<string, LegacyCommand>(),
                        );
                    } else {
                        await event.execute(...args, client);
                    }
                } catch (error) {
                    logger.error(`Error executing event ${event.name}:`, error);
                }
            };

            const listener = (...args: unknown[]) => {
                executeWrapper(...args).catch((error) => {
                    logger.error(`Unhandled executeWrapper rejection for ${event.name}:`, error);
                });
            };
            if (event.once) {
                client.once(event.name, listener);
            } else {
                client.on(event.name, listener);
            }
            loadedListeners.push({
                eventName: event.name,
                listener,
            });

            logger.debug(`Loaded event: ${event.name}`);
        },
        onInvalidModule: ({ filePath }) => {
            logger.warn(`The event at ${filePath} is missing required properties.`);
        },
        onModuleLoadError: ({ filePath }, fileLoadError) => {
            const errMsg =
                fileLoadError instanceof Error ? fileLoadError.message : String(fileLoadError);
            const errStack = fileLoadError instanceof Error ? fileLoadError.stack : undefined;
            logger.error(`Error loading event file ${filePath}:`, errMsg, errStack);
        },
    });

    if (!result.directoryExists) {
        logger.warn(`Events directory not found: ${eventsPath}`);
        return;
    }

    registeredEventListeners.set(client, loadedListeners);
    logger.success(`Successfully loaded ${loadedListeners.length} events dynamically.`);
}
/**
 * 런타임에 바인딩된 이벤트 리스너를 해제합니다.
 */
export function unloadEvents(client: Client): void {
    const listeners = registeredEventListeners.get(client);
    if (!listeners || listeners.length === 0) {
        return;
    }

    for (const { eventName, listener } of listeners) {
        client.off(eventName, listener);
    }
    registeredEventListeners.delete(client);
}

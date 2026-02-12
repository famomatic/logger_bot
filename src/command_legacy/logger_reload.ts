import { Message, PermissionsBitField, Client, Events } from 'discord.js';
import dotenv from 'dotenv';
import type { LegacyCommand } from '../types/commands.js';
import { loadLegacyCommands, unloadLegacyCommands } from '../utils/loadLegacyCommands.js';
import { loadSlashCommands, unloadSlashCommands } from '../utils/loadSlashCommands.js';
import { loadEvents, unloadEvents } from '../utils/loadEvents.js';
import { config, reloadConfig } from '../config/config.js';
import { logger } from '../utils/logger.js';

const command: LegacyCommand = {
    name: 'reload',
    async execute(message: Message) {
        const memberPermissions = message.member?.permissions;
        const devLevel = config.getDevLevel(message.author.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 3 && !isAdmin) {
            await message.reply('이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.');
            return;
        }

        const reply = await message.reply('🔄 봇을 리로드 중입니다...');
        try {
            dotenv.config({ override: true });
            reloadConfig();
            unloadLegacyCommands(message.client as Client);
            await loadLegacyCommands(message.client as Client);
            unloadSlashCommands(message.client as Client);
            await loadSlashCommands(message.client as Client);
            unloadEvents(message.client as Client);
            await loadEvents(message.client as Client);
            message.client.on(Events.InteractionCreate, (i) => {
                void (async () => {
                    if (!i.isChatInputCommand()) return;
                    const cmd = message.client.commands?.get(i.commandName);
                    if (!cmd) return;
                    try {
                        await cmd.execute(i, message.client);
                    } catch (err) {
                        logger.error(
                            `Error executing command ${i.commandName}:`,
                            err instanceof Error ? err : new Error(String(err)),
                        );
                    }
                })();
            });
            await reply.edit('🔄 봇이 성공적으로 리로드되었습니다.');
        } catch (error) {
            logger.error('Reload failed:', error);
            await reply.edit('❌ 리로드 중 오류가 발생했습니다.');
        }
    },
};

export { command };

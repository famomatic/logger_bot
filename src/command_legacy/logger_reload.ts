import { Message, PermissionsBitField } from 'discord.js';
import type { LegacyCommand } from '../types/commands.js';
import { logger } from '../utils/logger.js';
import { canRunReload, executeReload } from '../commandShared/reloadCore.js';

const command: LegacyCommand = {
    name: 'reload',
    async execute(message: Message) {
        const memberPermissions = message.member?.permissions;
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (!canRunReload(message.author.id, Boolean(isAdmin))) {
            await message.reply('이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.');
            return;
        }

        const reply = await message.reply('🔄 봇을 리로드 중입니다...');
        try {
            await executeReload(message.client);
            await reply.edit('🔄 봇이 성공적으로 리로드되었습니다.');
        } catch (error) {
            logger.error('Reload failed:', error);
            await reply.edit('❌ 리로드 중 오류가 발생했습니다.');
        }
    },
};

export { command };

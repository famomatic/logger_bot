import { executeReload } from '../commandShared/reloadCore.js';
import { config } from '../config/config.js';
import { getMessageLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { LegacyCommand } from '../types/commands.js';
import type { Message } from 'discord.js';

const command: LegacyCommand = {
    name: 'reload',
    async execute(message: Message) {
        const locale = getMessageLocale(message);
        if (!config.superAdminIds.includes(message.author.id)) {
            await message.reply(t(locale, 'common.devOnly'));
            return;
        }

        const reply = await message.reply(t(locale, 'reload.inProgress'));
        try {
            await executeReload(message.client);
            await reply.edit(t(locale, 'reload.success'));
        } catch (error) {
            logger.error('Reload failed:', error);
            await reply.edit(t(locale, 'reload.failed'));
        }
    },
};

/**
 * 레거시 커맨드 모듈 계약(`export { command }`)입니다.
 */
export { command };

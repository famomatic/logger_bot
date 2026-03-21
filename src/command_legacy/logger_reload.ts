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
            const result = await executeReload(message.client);
            const suffix =
                result.warnings.length > 0 ? `\n\nWarning: ${result.warnings.join('\n')}` : '';
            await reply.edit(`${t(locale, 'reload.success')}${suffix}`);
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

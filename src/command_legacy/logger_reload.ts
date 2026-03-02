import { Message, PermissionsBitField } from 'discord.js';
import type { LegacyCommand } from '../types/commands.js';
import { logger } from '../utils/logger.js';
import { canRunReload, executeReload } from '../commandShared/reloadCore.js';
import { getMessageLocale, t } from '../i18n/index.js';

const command: LegacyCommand = {
    name: 'reload',
    async execute(message: Message) {
        const locale = getMessageLocale(message);
        const memberPermissions = message.member?.permissions;
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (!canRunReload(message.author.id, Boolean(isAdmin))) {
            await message.reply(t(locale, 'common.adminOrDevOnly'));
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

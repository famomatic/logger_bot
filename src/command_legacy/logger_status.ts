import { buildStatusReply, collectStatusSnapshot } from '../commandShared/statusCore.js';
import { config } from '../config/config.js';
import { getMessageLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { LegacyCommand } from '../types/commands.js';
import type { Message } from 'discord.js';

const command: LegacyCommand = {
    name: 'status',
    async execute(message: Message) {
        const locale = getMessageLocale(message);
        if (!config.superAdminIds.includes(message.author.id)) {
            await message.reply(t(locale, 'common.devOnly'));
            return;
        }
        try {
            const client = message.client;
            const snapshot = await collectStatusSnapshot(client, 'legacy', locale);
            const replyOptions = buildStatusReply(client, snapshot, locale, 0x1abc9c);

            await message.reply(replyOptions);
        } catch (error) {
            const err = error as Error;
            logger.error('Error executing legacy status command:', err);
            logger.error(
                'Full error object for legacy status:',
                JSON.stringify(err, Object.getOwnPropertyNames(err)),
            );
            await message.reply({
                content: t(locale, 'status.fetchError', { error: err.message }),
                allowedMentions: { parse: [] },
            });
        }
    },
};

/**
 * 레거시 커맨드 모듈 계약(`export { command }`)입니다.
 */
export { command };

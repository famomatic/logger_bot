import {
    createPendingPingReply,
    createPingResultReply,
    resolvePingMetrics,
} from '../commandShared/pingCore.js';
import { config } from '../config/config.js'; // config 임포트
import { getMessageLocale, t } from '../i18n/index.js';

import type { LegacyCommand } from '../types/commands.js'; // LegacyCommand 인터페이스 임포트
import type { Message } from 'discord.js';

// const developerIds = ['YOUR_USER_ID']; // 이 줄은 삭제

const command: LegacyCommand = {
    name: 'ping',
    async execute(message: Message) {
        const locale = getMessageLocale(message);
        if (!config.superAdminIds.includes(message.author.id)) {
            await message.reply(t(locale, 'common.devOnly'));
            return;
        }
        const sentMessage = await message.reply(createPendingPingReply(locale));
        const metrics = await resolvePingMetrics(
            message.createdTimestamp,
            sentMessage.createdTimestamp,
            message.client,
        );

        await sentMessage.edit(createPingResultReply(metrics, locale));
    },
};

/**
 * 레거시 커맨드 모듈 계약(`export { command }`)입니다.
 */
export { command };

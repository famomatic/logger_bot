import { Message } from 'discord.js';
import type { LegacyCommand } from '../types/commands.js'; // LegacyCommand 인터페이스 임포트
import { config } from '../config/config.js'; // config 임포트
import {
    createPendingPingReply,
    createPingResultReply,
    resolvePingMetrics,
} from '../commandShared/pingCore.js';

// const developerIds = ['YOUR_USER_ID']; // 이 줄은 삭제

const command: LegacyCommand = {
    name: 'ping',
    async execute(message: Message) {
        if (config.getDevLevel(message.author.id) < 1) {
            await message.reply('이 명령어는 개발자만 사용할 수 있습니다.');
            return;
        }
        const sentMessage = await message.reply(createPendingPingReply());
        const metrics = await resolvePingMetrics(
            message.createdTimestamp,
            sentMessage.createdTimestamp,
            message.client,
        );

        await sentMessage.edit(createPingResultReply(metrics));
    },
};

export { command };

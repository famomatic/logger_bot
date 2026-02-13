import { Colors, Message } from 'discord.js';
import type { LegacyCommand } from '../types/commands.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { buildStatusEmbed, collectStatusSnapshot } from '../commandShared/statusCore.js';

const command: LegacyCommand = {
    name: 'status',
    async execute(message: Message) {
        if (config.getDevLevel(message.author.id) < 1) {
            await message.reply('이 명령어는 개발자만 사용할 수 있습니다.');
            return;
        }
        try {
            const client = message.client;
            const snapshot = await collectStatusSnapshot(client, 'legacy');
            const embed = buildStatusEmbed(client, snapshot, Colors.Aqua);

            await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        } catch (error) {
            const err = error as Error;
            logger.error('Error executing legacy status command:', err);
            logger.error(
                'Full error object for legacy status:',
                JSON.stringify(err, Object.getOwnPropertyNames(err)),
            );
            await message.reply({
                content: `상태 정보를 가져오는 중 오류가 발생했습니다: ${err.message}`,
                allowedMentions: { parse: [] },
            });
        }
    },
};

export { command };

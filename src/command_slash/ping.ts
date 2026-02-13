import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
    createPendingPingReply,
    createPingResultReply,
    resolvePingMetrics,
} from '../commandShared/pingCore.js';

// 일반 사용자도 사용 가능하므로 별도 권한 확인 없음

export const command = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('봇의 현재 지연 시간과 웹소켓 상태를 보여줍니다.'),
    async execute(interaction: ChatInputCommandInteraction) {
        logger.info(`/ping command executed by ${interaction.user.tag}`);
        const sentReply = await interaction.reply({
            ...createPendingPingReply(),
            fetchReply: true,
        });
        const metrics = await resolvePingMetrics(
            interaction.createdTimestamp,
            sentReply.createdTimestamp,
            interaction.client,
        );

        await interaction.editReply(createPingResultReply(metrics));
    },
};

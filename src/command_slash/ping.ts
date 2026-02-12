import { SlashCommandBuilder, ChatInputCommandInteraction, WebSocketShardStatus, TextDisplayBuilder, MessageFlags, SeparatorBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

// 일반 사용자도 사용 가능하므로 별도 권한 확인 없음

export const command = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('봇의 현재 지연 시간과 웹소켓 상태를 보여줍니다.'),
    async execute(interaction: ChatInputCommandInteraction) {
        logger.info(`/ping command executed by ${interaction.user.tag}`);
        const sentReply = await interaction.reply({ 
            flags: MessageFlags.IsComponentsV2,
            components: [new TextDisplayBuilder().setContent('🏓 퐁! 지연시간 계산중...')],
            fetchReply: true 
        });
        const latency = sentReply.createdTimestamp - interaction.createdTimestamp;
        
        let apiLatency = Math.round(interaction.client.ws.ping);
        let wsStatus = interaction.client.ws.status;

        if (apiLatency === -1) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
            apiLatency = Math.round(interaction.client.ws.ping);
            wsStatus = interaction.client.ws.status; // 상태도 다시 가져오기
        }

        const wsStatusString = WebSocketShardStatus[wsStatus] || wsStatus.toString();

        await interaction.editReply({ 
            components: [
                new TextDisplayBuilder()
                    .setContent(
                        `🏓 퐁! 현재 봇 지연시간: ${latency}ms`
                    ),
                new SeparatorBuilder(),
                new TextDisplayBuilder()
                    .setContent(
                        `API 지연시간: ${apiLatency}ms`
                    ),
                new SeparatorBuilder(),
                new TextDisplayBuilder()
                    .setContent(
                        `웹소켓 상태: ${wsStatusString}`
                    )
            ],
        });
    },
};
import { Message, WebSocketShardStatus, TextDisplayBuilder, MessageFlags, SeparatorBuilder } from 'discord.js';
import { LegacyCommand } from '../utils/loadLegacyCommands.js'; // LegacyCommand 인터페이스 임포트
import { config } from '../config/config.js'; // config 임포트

// const developerIds = ['YOUR_USER_ID']; // 이 줄은 삭제

const command: LegacyCommand = {
    name: 'ping',
    async execute(message: Message) {
        if (config.getDevLevel(message.author.id) < 1) {
            await message.reply('이 명령어는 개발자만 사용할 수 있습니다.');
            return;
        }
        const sentMessage = await message.reply({ 
            flags: MessageFlags.IsComponentsV2,
            components: [new TextDisplayBuilder().setContent('🏓 퐁! 지연시간 계산중...')],
        });
        const latency = sentMessage.createdTimestamp - message.createdTimestamp;
        
        let apiLatency = Math.round(message.client.ws.ping);
        let wsStatus = message.client.ws.status;

        if (apiLatency === -1) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
            apiLatency = Math.round(message.client.ws.ping);
            wsStatus = message.client.ws.status; // 상태도 다시 가져오기
        }
        
        const wsStatusString = WebSocketShardStatus[wsStatus] || wsStatus.toString();

        await sentMessage.edit({ 
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

export { command }; 
import {
    SlashCommandBuilder,
    CommandInteraction,
    PermissionsBitField,
    Client,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import type { SlashCommand } from '../types/commands.js';
import {
    NoAccessibleGuildChannelsError,
    runGuildMessageBackfill,
} from '../services/logGuildMessagesService.js';

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('log-guild-messages')
        .setDescription('{guild_id} 서버의 모든 메시지를 가져와 DB에 기록합니다.')
        .addStringOption((option) =>
            option
                .setName('guild_id')
                .setDescription('메시지를 기록할 서버의 ID')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .setContexts(InteractionContextType.Guild),

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버 내에서만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);

        if (devLevel < 3 && !isAdmin) {
            await interaction.reply({
                content: '이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const targetGuildId = interaction.options.getString('guild_id', true);
        logger.info(
            `Initiating bulk message logging for guild ${targetGuildId} by ${interaction.user.tag} (${interaction.user.id})`,
        );
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const legacyCommandPrefixes = client.legacyCommands
            ? Array.from(client.legacyCommands.keys())
            : [];

        try {
            const guild = await client.guilds.fetch(targetGuildId);
            const result = await runGuildMessageBackfill({
                guild,
                legacyCommandPrefixes,
            });

            let finalReply = `✅ **메시지 기록 확인 완료**\n\n`;
            finalReply += `> - **처리된 채널:** ${result.totalChannels}개\n`;
            finalReply += `> - **확인된 메시지 (봇 제외):** ${result.processedCount}개\n`;
            finalReply += `> - **새로 기록된 메시지:** ${result.newlyLoggedCount}개\n`;
            finalReply += `> - **활동 유저 수 (추정):** ${result.uniqueUserCount}명\n`;
            if (result.errorCount > 0) {
                finalReply += `> - **오류 발생:** ⚠️ ${result.errorCount}개\n`;
            }
            finalReply += `> - **총 소요 시간:** ${result.durationSeconds.toFixed(2)}초\n\n`;
            finalReply += `ℹ️ 자세한 채널별 내역은 봇 로그를 확인하세요.`;

            if (result.durationSeconds > 900) {
                await interaction.channel?.send(`${interaction.user.toString()} ${finalReply}`);
                await interaction.editReply({
                    content:
                        '✅ 작업이 완료되었으나, 15분이 초과되어 현재 채널에 일반 메시지로 결과를 전송했습니다.',
                });
                return;
            }

            await interaction.followUp(finalReply);
            logger.info(
                `Finished bulk message logging check for guild ${targetGuildId}. Processed ${result.totalChannels} channels, checked ${result.processedCount} messages, newly logged ${result.newlyLoggedCount} from approx ${result.uniqueUserCount} users with ${result.errorCount} errors in ${result.durationSeconds}s.`,
            );
        } catch (error) {
            if (error instanceof NoAccessibleGuildChannelsError) {
                await interaction.editReply(
                    '오류: 이 서버에서 메시지 기록을 읽을 수 있는 채널을 찾을 수 없습니다. (봇 권한 확인 필요)',
                );
                return;
            }

            logger.error(
                `Critical error during bulk message logging check for guild ${targetGuildId}:`,
                error,
            );
            const err = error as Error;
            const errorMessage = `메시지 기록 확인/처리 중 심각한 오류가 발생했습니다: ${String(err.message || err).substring(0, 1800)}`;

            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await interaction.reply({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    },
};

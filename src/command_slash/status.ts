import { SlashCommandBuilder, ChatInputCommandInteraction, Colors } from 'discord.js';
import { logger } from '../utils/logger.js';
import { buildStatusEmbed, collectStatusSnapshot } from '../commandShared/statusCore.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('봇의 상세 상태 정보를 보여줍니다.'),
    async execute(interaction: ChatInputCommandInteraction) {
        logger.info(`/status command executed by ${interaction.user.tag}`);
        try {
            await interaction.deferReply({ ephemeral: false });

            const client = interaction.client;
            const snapshot = await collectStatusSnapshot(client, 'slash');
            const embed = buildStatusEmbed(client, snapshot, Colors.Blue);

            await interaction.editReply({
                embeds: [embed],
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            const err = error as Error;
            logger.error('Error executing slash status command:', err);
            logger.error(
                'Full error object for slash status:',
                JSON.stringify(err, Object.getOwnPropertyNames(err)),
            );
            const errContent = `상태 정보를 가져오는 중 오류가 발생했습니다: ${err.message}`;
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errContent, embeds: [], components: [] });
            } else {
                await interaction.reply({ content: errContent, ephemeral: true });
            }
        }
    },
};

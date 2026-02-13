import {
    SlashCommandBuilder,
    CommandInteraction,
    Client,
    PermissionsBitField,
    MessageFlags,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import type { SlashCommand } from '../types/commands.js';
import { canRunReload, executeReload } from '../commandShared/reloadCore.js';

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('봇의 명령어 및 이벤트를 다시 로드합니다.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator), // 관리자만 사용 가능하도록 설정

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (!canRunReload(interaction.user.id, Boolean(isAdmin))) {
            await interaction.reply({
                content: '이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        logger.info(`/reload command executed by ${interaction.user.tag}`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            await executeReload(client);
            await interaction.editReply('🔄 봇이 성공적으로 리로드되었습니다.');
        } catch (error) {
            logger.error('Reload failed:', error);
            await interaction.editReply('❌ 리로드 중 오류가 발생했습니다.');
        }
    },
};

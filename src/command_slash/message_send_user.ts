import { SlashCommandBuilder, CommandInteraction, PermissionsBitField, Client, User, SlashCommandOptionsOnlyBuilder, MessageFlags } from 'discord.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

// 타입 정의
interface SlashCommand {
    data: SlashCommandOptionsOnlyBuilder;
    execute: (interaction: CommandInteraction, client: Client) => Promise<void>;
}

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-send-user')
        .setDescription('지정한 사용자에게 DM으로 메시지를 전송합니다.')
        .addStringOption(option =>
            option.setName('userid')
                .setDescription('메시지를 받을 사용자의 ID')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('content')
                .setDescription('전송할 메시지 내용')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator) // 관리자만 사용 가능하도록 설정
        .setDMPermission(false), // 서버 내에서만 사용 가능

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        if (!interaction.inGuild()) {
            await interaction.reply({ content: '이 명령어는 서버 내에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
            return;
        }

        // 개발자 또는 관리자 권한 확인
        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 3 && !isAdmin) {
            await interaction.reply({ content: '이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
            return;
        }

        logger.info(`/message-send-user command executed by ${interaction.user.tag}`);

        const targetUserId = interaction.options.getString('userid', true);
        const messageContent = interaction.options.getString('content', true);
        const logPrefix = '[message-send-user]';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let targetUser: User | null = null;
        try {
            // 사용자 ID 유효성 검사
            if (!/^\d{17,19}$/.test(targetUserId)) {
                await interaction.editReply({ content: `오류: 제공된 사용자 ID (${targetUserId})가 올바른 형식이 아닙니다.` });
                return;
            }
            targetUser = await client.users.fetch(targetUserId);
        } catch (error) {
            logger.warn(`${logPrefix} Failed to fetch user ${targetUserId}:`, error);
            await interaction.editReply({ content: `오류: 사용자 ID ${targetUserId}를 찾을 수 없습니다.` });
            return;
        }

        if (!targetUser) {
            // 이 경우는 거의 없지만 안전을 위해 추가
            await interaction.editReply({ content: `오류: 사용자 ID ${targetUserId}를 찾을 수 없습니다.` });
            return;
        }

        try {
            await targetUser.send(messageContent);
            logger.info(`${logPrefix} Successfully sent DM to ${targetUser.tag} (${targetUserId}) by ${interaction.user.tag}. Content length: ${messageContent.length}`);
            await interaction.editReply({ content: `✅ 사용자 ${targetUser.tag} (${targetUserId})에게 메시지를 성공적으로 전송했습니다.` });
        } catch (error) {
            const err = error as { code?: number; message: string };
            logger.error(`${logPrefix} Failed to send DM to ${targetUser.tag} (${targetUserId}):`, err);
            if (err.code === 50007) { // Cannot send messages to this user (DMs disabled or bot blocked)
                await interaction.editReply({ content: `❌ 오류: ${targetUser.tag} (${targetUserId})님에게 DM을 보낼 수 없습니다. (DM 비활성화 또는 봇 차단)` });
            } else {
                await interaction.editReply({ content: `❌ 오류: ${targetUser.tag} (${targetUserId})님에게 메시지를 보내는 중 오류가 발생했습니다: ${err.message}` });
            }
        }
    },
}; 
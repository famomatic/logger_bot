import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    PermissionsBitField,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';
import { config } from '../config/config.js';
import { authorizeGuildId } from '../db/database.js';
import { logger } from '../utils/logger.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('authorize')
        .setDescription('길드를 승인 목록에 추가합니다.')
        .addStringOption((o) =>
            o.setName('guild_id').setDescription('승인할 길드 ID').setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .setContexts(InteractionContextType.Guild),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버에서만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 3 && !isAdmin) {
            await interaction.reply({
                content: '이 명령어는 관리자 또는 레벨3 개발자만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const gid = interaction.options.getString('guild_id', true);
        await authorizeGuildId(gid);
        logger.info(`/authorize executed by ${interaction.user.tag} for guild ${gid}`);
        await interaction.reply({
            content: `✅ 길드 ${gid} 이(가) 승인되었습니다.`,
            flags: MessageFlags.Ephemeral,
        });
    },
};

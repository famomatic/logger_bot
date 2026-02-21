import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionsBitField,
    EmbedBuilder,
    Colors,
} from 'discord.js';
import { config } from '../config/config.js';
import { fetchAlertSubscriptions } from '../db/database.js';
import { categoryEventMap } from '../utils/alertManager.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('log-alert-list')
        .setDescription('현재 서버의 로그 알림 설정 목록을 보여줍니다.')
        .setDMPermission(false),
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
        if (devLevel < 2 && !isAdmin) {
            await interaction.reply({
                content: '이 명령어는 레벨2 이상 개발자 또는 관리자만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const rows = await fetchAlertSubscriptions();
        const guildRows = rows.filter((row) => row.guild_id === interaction.guildId);

        const embed = new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle('로그 알림 구독 목록')
            .setDescription(
                guildRows.length === 0
                    ? '설정된 알림 구독이 없습니다.'
                    : `총 ${guildRows.length.toLocaleString('ko-KR')}개`,
            )
            .setTimestamp(new Date())
            .setFooter({ text: `요청자: ${interaction.user.tag}` });

        if (guildRows.length > 0) {
            const lines = guildRows.slice(0, 25).map((row, index) => {
                const events = categoryEventMap[row.category] ?? [];
                return `${index + 1}. 카테고리: \`${row.category}\` | 채널: <#${row.channel_id}> | 이벤트 수: ${events.length}`;
            });
            embed.addFields({
                name: '구독 목록',
                value: lines.join('\n'),
                inline: false,
            });

            if (guildRows.length > 25) {
                embed.addFields({
                    name: '안내',
                    value: `표시는 25개까지만 제공합니다. (총 ${guildRows.length.toLocaleString('ko-KR')}개)`,
                    inline: false,
                });
            }
        }

        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
};

import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionsBitField,
    InteractionContextType,
} from 'discord.js';
import { config } from '../config/config.js';
import { fetchAlertSubscriptions } from '../db/database.js';
import { categoryEventMap } from '../utils/alertManager.js';
import { buildContainerMessage } from '../commandShared/componentsV2.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('log-alert-list')
        .setDescription('현재 서버의 로그 알림 설정 목록을 보여줍니다.')
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
        if (devLevel < 2 && !isAdmin) {
            await interaction.reply({
                content: '이 명령어는 레벨2 이상 개발자 또는 관리자만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });

        const rows = await fetchAlertSubscriptions();
        const guildRows = rows.filter((row) => row.guild_id === interaction.guildId);

        const sections: { title: string; body: string }[] = [];

        if (guildRows.length > 0) {
            const lines = guildRows.slice(0, 25).map((row, index) => {
                const events = categoryEventMap[row.category] ?? [];
                return `${index + 1}. 카테고리: \`${row.category}\` | 채널: <#${row.channel_id}> | 이벤트 수: ${events.length}`;
            });
            sections.push({
                title: '구독 목록',
                body: lines.join('\n'),
            });

            if (guildRows.length > 25) {
                sections.push({
                    title: '안내',
                    body: `표시는 25개까지만 제공합니다. (총 ${guildRows.length.toLocaleString('ko-KR')}개)`,
                });
            }
        }

        await interaction.editReply(
            buildContainerMessage({
                title: '로그 알림 구독 목록',
                description:
                    guildRows.length === 0
                        ? '설정된 알림 구독이 없습니다.'
                        : `총 ${guildRows.length.toLocaleString('ko-KR')}개`,
                accentColor: 0x5865f2,
                sections,
                footer: `요청자: ${interaction.user.tag}`,
            }),
        );
    },
};

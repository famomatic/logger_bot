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
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('log-alert-list')
        .setDescription(defaultText('logAlert.listDescription'))
        .setContexts(InteractionContextType.Guild),
    async execute(interaction: ChatInputCommandInteraction) {
        const locale = getInteractionLocale(interaction);
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuild'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (devLevel < 2 && !isAdmin) {
            await interaction.reply({
                content: t(locale, 'common.level2OrAdminOnly'),
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
                return t(locale, 'logAlert.listSectionLine', {
                    index: index + 1,
                    category: row.category,
                    channelId: row.channel_id,
                    eventCount: events.length,
                });
            });
            sections.push({
                title: t(locale, 'logAlert.listSectionTitle'),
                body: lines.join('\n'),
            });

            if (guildRows.length > 25) {
                sections.push({
                    title: t(locale, 'logAlert.noticeTitle'),
                    body: t(locale, 'logAlert.noticeBody', {
                        count: guildRows.length.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US'),
                    }),
                });
            }
        }

        await interaction.editReply(
            buildContainerMessage({
                title: t(locale, 'logAlert.listTitle'),
                description:
                    guildRows.length === 0
                        ? t(locale, 'logAlert.noSubscriptions')
                        : t(locale, 'logAlert.totalSubscriptions', {
                              count: guildRows.length.toLocaleString(
                                  locale === 'ko' ? 'ko-KR' : 'en-US',
                              ),
                          }),
                accentColor: 0x5865f2,
                sections,
                footer: t(locale, 'logAlert.requesterFooter', { tag: interaction.user.tag }),
            }),
        );
    },
};

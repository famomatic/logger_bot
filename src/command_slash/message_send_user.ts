import {
    ApplicationIntegrationType,
    SlashCommandBuilder,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';

import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { SlashCommand } from '../types/commands.js';
import type { ErrorWithCode } from '../types/errors.js';
import type { CommandInteraction, Client, User } from 'discord.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-send-user')
        .setDescription(defaultText('messageCmd.sendUserDesc'))
        .addStringOption((option) =>
            option
                .setName('userid')
                .setDescription(defaultText('messageCmd.userId'))
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('content')
                .setDescription(defaultText('messageCmd.content'))
                .setRequired(true),
        ) // 관리자만 사용 가능하도록 설정
        .setIntegrationTypes(
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
        )
        .setContexts(InteractionContextType.Guild), // 서버 내에서만 사용 가능

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        const locale = getInteractionLocale(interaction);
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuildStrict'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // 개발자 또는 관리자 권한 확인
        if (!(await ensureSlashCommandPermission(interaction))) {
            return;
        }

        logger.info(`/message-send-user command executed by ${interaction.user.tag}`);

        const targetUserId = interaction.options.getString('userid', true);
        const messageContent = interaction.options.getString('content', true);
        const logPrefix = '[message-send-user]';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let targetUser: User;
        try {
            // 사용자 ID 유효성 검사
            if (!/^\d{17,19}$/.test(targetUserId)) {
                await interaction.editReply({
                    content: t(locale, 'messageCmd.invalidProvidedUserId', {
                        userId: targetUserId,
                    }),
                });
                return;
            }
            targetUser = await client.users.fetch(targetUserId);
        } catch (error) {
            logger.warn(`${logPrefix} Failed to fetch user ${targetUserId}:`, error);
            await interaction.editReply({
                content: t(locale, 'messageCmd.userNotFound', { userId: targetUserId }),
            });
            return;
        }

        try {
            await targetUser.send(messageContent);
            logger.info(
                `${logPrefix} Successfully sent DM to ${targetUser.tag} (${targetUserId}) by ${interaction.user.tag}. Content length: ${messageContent.length}`,
            );
            await interaction.editReply({
                content: t(locale, 'messageCmd.sentToUser', {
                    tag: targetUser.tag,
                    userId: targetUserId,
                }),
            });
        } catch (error) {
            const err = error as ErrorWithCode;
            logger.error(
                `${logPrefix} Failed to send DM to ${targetUser.tag} (${targetUserId}):`,
                err,
            );
            if (err.code === 50007) {
                // Cannot send messages to this user (DMs disabled or bot blocked)
                await interaction.editReply({
                    content: t(locale, 'messageCmd.cannotDmUser', {
                        tag: targetUser.tag,
                        userId: targetUserId,
                    }),
                });
            } else {
                await interaction.editReply({
                    content: t(locale, 'messageCmd.sendToUserFailed', {
                        tag: targetUser.tag,
                        userId: targetUserId,
                        error: err.message ?? t(locale, 'common.unknownError'),
                    }),
                });
            }
        }
    },
};

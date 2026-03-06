import {
    SlashCommandBuilder,
    CommandInteraction,
    PermissionsBitField,
    GuildTextBasedChannel,
    Collection,
    Message,
    Client,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import type { SlashCommand } from '../types/commands.js';
import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';

// 슬래시 커맨드 정의 및 실행 로직
/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-delete-user') // <<< 이름 변경됨
        .setDescription(defaultText('messageCmd.deleteUserDesc'))
        .addStringOption((option) =>
            option
                .setName('user_id')
                .setDescription(defaultText('messageCmd.userId'))
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('guild_id')
                .setDescription(defaultText('messageCmd.guildId'))
                .setRequired(false),
        )
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription(defaultText('messageCmd.channelId'))
                .setRequired(false),
        )
        .setContexts(InteractionContextType.Guild),

    async execute(interaction: CommandInteraction, client: Client) {
        // CommandInteraction 타입 가드 (ChatInputCommand으로 좁히기 위함)
        if (!interaction.isChatInputCommand()) return;
        const locale = getInteractionLocale(interaction);
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuildStrict'),
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        if (!(await ensureSlashCommandPermission(interaction))) {
            return;
        }

        logger.info(`/message-delete-user command executed by ${interaction.user.tag}`);

        const targetGuildIdOption = interaction.options.getString('guild_id');
        if (targetGuildIdOption && targetGuildIdOption !== interaction.guildId) {
            await interaction.reply({
                content: t(locale, 'common.commandNotAllowed'),
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }
        const targetChannelIdOption = interaction.options.getString('channel_id');
        const targetUserId = interaction.options.getString('user_id', true);

        if (!targetGuildIdOption && !targetChannelIdOption) {
            await interaction.reply({
                content: t(locale, 'messageCmd.requireGuildOrChannel'),
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        let targetGuildId = targetGuildIdOption ?? undefined;
        let specificChannel: GuildTextBasedChannel | null = null;

        if (targetChannelIdOption) {
            try {
                const fetched = await client.channels.fetch(targetChannelIdOption);
                if (
                    !fetched ||
                    !fetched.isTextBased() ||
                    fetched.isDMBased() ||
                    !('guild' in fetched)
                ) {
                    await interaction.reply({
                        content: t(locale, 'messageCmd.invalidGuildChannel', {
                            channelId: targetChannelIdOption,
                        }),
                        flags: [MessageFlags.Ephemeral],
                    });
                    return;
                }
                specificChannel = fetched as GuildTextBasedChannel;
            } catch (err) {
                logger.error(
                    `[message-delete-user] Failed to fetch channel ${targetChannelIdOption}:`,
                    err,
                );
                await interaction.reply({
                    content: t(locale, 'messageCmd.fetchChannelFailed'),
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }
            if (targetGuildId && specificChannel.guildId !== targetGuildId) {
                await interaction.reply({
                    content: t(locale, 'messageCmd.channelGuildMismatch'),
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }
            targetGuildId = specificChannel.guildId;
        }

        // 응답 지연 (ephemeral: true 로 설정하여 명령어 사용자에게만 보이게 함)
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        // 로그 접두사 변경
        const logPrefix = '[message-delete-user]';
        logger.info(
            `${logPrefix} Initiating message deletion for user ${targetUserId} in guild ${targetGuildId} by ${interaction.user.tag} (${interaction.user.id})`,
        );

        // 응답 보낼 채널 타입 확인 및 저장
        const channelToSendResponse = interaction.channel;
        if (!channelToSendResponse || !('send' in channelToSendResponse)) {
            logger.error(
                `${logPrefix} Cannot send response: Interaction channel is not text-based or lacks send permissions. Channel type: ${interaction.channel?.type}`,
            );
            try {
                await interaction
                    .editReply({ content: t(locale, 'messageCmd.cannotSendResponseChannel') })
                    .catch(() => {
                        /* empty */
                    });
            } catch {
                /* Ignore */
            }
            return;
        }

        let deletedCount = 0;
        const errorMessages: string[] = [];
        const startTime = Date.now();

        try {
            // 대상 길드 가져오기
            const guild = specificChannel
                ? specificChannel.guild
                : await client.guilds.fetch(targetGuildId!).catch(() => null);
            if (!guild) {
                logger.warn(
                    `${logPrefix} Attempted deletion in non-existent or inaccessible guild ${targetGuildId}`,
                );
                await interaction.editReply(
                    t(locale, 'messageCmd.guildNotFound', { guildId: targetGuildId! }),
                );
                return;
            }

            // 대상 사용자 유효성 검사
            if (!/^\d{17,19}$/.test(targetUserId)) {
                await interaction.editReply(
                    t(locale, 'messageCmd.invalidProvidedUserId', { userId: targetUserId }),
                );
                return;
            }

            const channels = specificChannel
                ? new Collection<string, GuildTextBasedChannel>([
                      [specificChannel.id, specificChannel],
                  ])
                : guild.channels.cache.filter(
                      (ch): ch is GuildTextBasedChannel =>
                          ch.isTextBased() &&
                          !ch.isThread() &&
                          ch.viewable &&
                          (ch
                              .permissionsFor(guild.members.me!)
                              ?.has(PermissionsBitField.Flags.ReadMessageHistory) ??
                              false) &&
                          (ch
                              .permissionsFor(guild.members.me!)
                              ?.has(PermissionsBitField.Flags.ManageMessages) ??
                              false),
                  );

            if (channels.size === 0) {
                logger.warn(
                    `${logPrefix} No accessible channels found for deletion in guild ${targetGuildId}`,
                );
                await interaction.editReply(t(locale, 'messageCmd.noAccessibleDeleteChannels'));
                return;
            }

            if (specificChannel) {
                logger.info(
                    `${logPrefix} Deleting messages only in channel ${specificChannel.id} of guild ${targetGuildId}`,
                );
                await interaction.editReply(
                    t(locale, 'messageCmd.startDeleteInChannel', {
                        channel: specificChannel.name,
                        channelId: specificChannel.id,
                        userId: targetUserId,
                    }),
                );
            } else {
                logger.info(
                    `${logPrefix} Found ${channels.size} accessible text channels in guild ${targetGuildId} to scan.`,
                );
                await interaction.editReply(
                    t(locale, 'messageCmd.startDeleteInGuild', {
                        guild: guild.name,
                        guildId: targetGuildId!,
                        count: channels.size,
                        userId: targetUserId,
                    }),
                );
            }

            for (const channel of channels.values()) {
                logger.debug(`${logPrefix} Scanning channel ${channel.name} (${channel.id})`);
                let lastMessageId: string | undefined = undefined;
                let fetchMore = true;
                let channelDeletedCount = 0;
                const channelStartTime = Date.now();

                while (fetchMore) {
                    try {
                        const messages: Collection<string, Message> = await channel.messages.fetch({
                            limit: 100,
                            before: lastMessageId,
                        });
                        if (messages.size === 0) {
                            fetchMore = false;
                            continue;
                        }
                        const userMessages = messages.filter(
                            (msg) => msg.author.id === targetUserId,
                        );
                        lastMessageId = messages.lastKey();

                        if (userMessages.size > 0) {
                            logger.debug(
                                `${logPrefix} Found ${userMessages.size} messages from user ${targetUserId} in batch for channel ${channel.id}`,
                            );
                            for (const message of userMessages.values()) {
                                let retries = 0;
                                let deletedSuccessfully = false;
                                while (retries < 3 && !deletedSuccessfully) {
                                    try {
                                        await message.delete();
                                        deletedCount++;
                                        channelDeletedCount++;
                                        deletedSuccessfully = true;
                                        await new Promise((resolve) =>
                                            setTimeout(resolve, 100 + Math.random() * 50),
                                        );
                                    } catch (error) {
                                        const deleteError = error as {
                                            code?: number;
                                            status?: number;
                                            retryAfter?: number;
                                            message: string;
                                        };
                                        if (deleteError.code === 10008) {
                                            deletedSuccessfully = true;
                                            break;
                                        }
                                        if (deleteError.status === 429) {
                                            retries++;
                                            const retryAfter = (deleteError.retryAfter ?? 5) * 1000;
                                            logger.warn(
                                                `${logPrefix} Rate limited deleting message ${message.id}. Retrying after ${retryAfter}ms... (Attempt ${retries}/3)`,
                                            );
                                            await interaction
                                                .followUp({
                                                    content: t(
                                                        locale,
                                                        'messageCmd.rateLimitRetry',
                                                        {
                                                            seconds: retryAfter / 1000,
                                                            try: retries,
                                                        },
                                                    ),
                                                    ephemeral: true,
                                                })
                                                .catch(() => {
                                                    /* empty */
                                                });
                                            await new Promise((resolve) =>
                                                setTimeout(resolve, retryAfter + 500),
                                            );
                                        } else {
                                            logger.warn(
                                                `${logPrefix} Failed to delete message ${message.id} in channel ${channel.id}: ${deleteError.message} (Code: ${deleteError.code})`,
                                            );
                                            if (
                                                !errorMessages.some((e) => e.includes(channel.id))
                                            ) {
                                                errorMessages.push(
                                                    `channel ${channel.name} (#${channel.id}): ${deleteError.message}`,
                                                );
                                            }
                                            break;
                                        }
                                    }
                                }
                                if (!deletedSuccessfully && retries >= 3) {
                                    logger.error(
                                        `${logPrefix} Failed to delete message ${message.id} after 3 retries due to rate limits.`,
                                    );
                                    if (!errorMessages.some((e) => e.includes(message.id))) {
                                        errorMessages.push(
                                            `message ${message.id} (channel #${channel.id}): failed after 3 retries (rate limit)`,
                                        );
                                    }
                                }
                            }
                        }
                        if (messages.size < 100) {
                            fetchMore = false;
                        }
                    } catch (error) {
                        const fetchError = error as Error;
                        logger.error(
                            `${logPrefix} Failed to fetch messages in channel ${channel.id}: ${fetchError.message}`,
                        );
                        if (!errorMessages.some((e) => e.includes(channel.id))) {
                            errorMessages.push(
                                `channel ${channel.name} (#${channel.id}) fetch error: ${fetchError.message}`,
                            );
                        }
                        fetchMore = false;
                    }
                }
                const channelEndTime = Date.now();
                if (channelDeletedCount > 0) {
                    logger.info(
                        `${logPrefix} Deleted ${channelDeletedCount} messages from user ${targetUserId} in channel ${channel.id}. Took ${((channelEndTime - channelStartTime) / 1000).toFixed(2)}s.`,
                    );
                } else {
                    logger.debug(
                        `${logPrefix} No messages found/deleted for user ${targetUserId} in channel ${channel.id}. Took ${((channelEndTime - channelStartTime) / 1000).toFixed(2)}s.`,
                    );
                }
            }

            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            let finalReport = specificChannel
                ? t(locale, 'messageCmd.finalDeleteReportChannel', {
                      userMention: interaction.user.toString(),
                      channel: specificChannel.name,
                      targetUserId,
                      count: deletedCount,
                      duration,
                  })
                : t(locale, 'messageCmd.finalDeleteReportGuild', {
                      userMention: interaction.user.toString(),
                      targetUserId,
                      count: deletedCount,
                      duration,
                  });
            if (errorMessages.length > 0) {
                finalReport += t(locale, 'messageCmd.errorSummaryHeader', {
                    count: errorMessages.length,
                    errors: errorMessages.slice(0, 10).join('\n- '),
                });
                if (errorMessages.length > 10) {
                    finalReport += t(locale, 'messageCmd.errorSummaryMore', {
                        count: errorMessages.length - 10,
                    });
                }
            }
            await channelToSendResponse.send(finalReport).catch((sendError: unknown) => {
                logger.error(`${logPrefix} Failed to send final deletion report:`, sendError);
            });
            try {
                await interaction.editReply(t(locale, 'messageCmd.deleteTaskDone')).catch(() => {
                    /* empty */
                });
            } catch {
                /* Ignore */
            }
            const channelInfo = specificChannel ? ` channel ${specificChannel.id}` : '';
            logger.info(
                `${logPrefix} Finished message deletion for user ${targetUserId} in guild ${targetGuildId}${channelInfo}. Deleted ${deletedCount} messages with ${errorMessages.length} errors in ${duration}s.`,
            );
        } catch (error) {
            const err = error as Error;
            logger.error(
                `${logPrefix} Critical error during message deletion process for guild ${targetGuildId}, user ${targetUserId}:`,
                err,
            );
            const criticalErrorMessage = t(locale, 'messageCmd.criticalDeleteError', {
                userMention: interaction.user.toString(),
                error: err.message,
            });
            if (channelToSendResponse) {
                await channelToSendResponse
                    .send(criticalErrorMessage)
                    .catch((sendError: unknown) => {
                        logger.error(
                            `${logPrefix} Failed to send critical error report for deletion:`,
                            sendError,
                        );
                    });
            }
            try {
                await interaction
                    .editReply(t(locale, 'messageCmd.criticalDeleteErrorSent'))
                    .catch(() => {
                        /* empty */
                    });
            } catch {
                /* Ignore */
            }
        }
    },
};

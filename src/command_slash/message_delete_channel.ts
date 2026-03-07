import {
    SlashCommandBuilder,
    PermissionsBitField,
    Collection,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';

import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { SlashCommand } from '../types/commands.js';
import type {
    CommandInteraction,
    GuildTextBasedChannel,
    Message,
    MessageComponentInteraction,
    Client,
} from 'discord.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-delete-channel')
        .setDescription(defaultText('messageCmd.deleteChannelDesc'))
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription(defaultText('messageCmd.channelId'))
                .setRequired(true),
        )
        .setContexts(InteractionContextType.Guild),

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
        if (!(await ensureSlashCommandPermission(interaction))) {
            return;
        }

        logger.info(`/message-delete-channel command executed by ${interaction.user.tag}`);

        const targetChannelId = interaction.options.getString('channel_id', true);
        const logPrefix = `[message-delete-channel ID:${targetChannelId}]`;

        let targetChannel: GuildTextBasedChannel;
        try {
            const fetchedChannel = await client.channels.fetch(targetChannelId);
            if (!fetchedChannel) {
                logger.warn(`${logPrefix} Channel with ID ${targetChannelId} not found.`);
                await interaction.reply({
                    content: t(locale, 'messageCmd.channelNotFound', {
                        channelId: targetChannelId,
                    }),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            if (
                !fetchedChannel.isTextBased() ||
                fetchedChannel.isDMBased() ||
                !('guild' in fetchedChannel)
            ) {
                // Check if it's a guild text-based channel
                logger.warn(
                    `${logPrefix} Channel ${targetChannelId} is not a valid guild text-based channel (Type: ${fetchedChannel.type}).`,
                );
                await interaction.reply({
                    content: t(locale, 'messageCmd.channelInvalidType', {
                        channelId: targetChannelId,
                    }),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            targetChannel = fetchedChannel as GuildTextBasedChannel;
            if (targetChannel.guildId !== interaction.guildId) {
                await interaction.reply({
                    content: t(locale, 'common.commandNotAllowed'),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
        } catch (error) {
            logger.error(`${logPrefix} Failed to fetch channel ${targetChannelId}:`, error);
            await interaction.reply({
                content: t(locale, 'backfill.channelFetchFailed', { channelId: targetChannelId }),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // 봇 권한 확인
        const botPermissionsInChannel = targetChannel.permissionsFor(client.user!);
        if (
            !botPermissionsInChannel?.has(PermissionsBitField.Flags.ReadMessageHistory) ||
            !botPermissionsInChannel.has(PermissionsBitField.Flags.ManageMessages)
        ) {
            logger.warn(
                `${logPrefix} Missing permissions (ReadMessageHistory or ManageMessages) in channel ${targetChannel.id} for guild ${interaction.guildId}.`,
            );
            await interaction.reply({
                content: t(locale, 'messageCmd.noReadOrDeletePermission', {
                    channel: targetChannel.name,
                }),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (!targetChannel.viewable) {
            logger.warn(`${logPrefix} Channel ${targetChannel.id} is not viewable by the bot.`);
            await interaction.reply({
                content: t(locale, 'messageCmd.channelNotViewable', {
                    channel: targetChannel.name,
                }),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // --- 사용자 확인 (버튼 방식) ---
        const confirmButtonId = `confirm-delete-channel-${interaction.id}-${targetChannel.id}`;
        const cancelButtonId = `cancel-delete-channel-${interaction.id}-${targetChannel.id}`;

        const confirmButton = new ButtonBuilder()
            .setCustomId(confirmButtonId)
            .setLabel(t(locale, 'messageCmd.confirmDeleteChannel', { channel: targetChannel.name }))
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId(cancelButtonId)
            .setLabel(t(locale, 'messageCmd.cancel'))
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            confirmButton,
            cancelButton,
        );

        const reply = await interaction.reply({
            content: t(locale, 'messageCmd.confirmPromptChannel', {
                channel: targetChannel.name,
                channelId: targetChannel.id,
            }),
            components: [row],
            flags: MessageFlags.Ephemeral,
            fetchReply: true,
        });

        try {
            const collectorFilter = (i: MessageComponentInteraction) =>
                i.user.id === interaction.user.id;
            const confirmation = await reply.awaitMessageComponent({
                filter: collectorFilter,
                componentType: ComponentType.Button,
                time: 60000,
            });

            if (confirmation.customId === confirmButtonId) {
                await confirmation.update({
                    content: t(locale, 'messageCmd.startDeleteChannel', {
                        channel: targetChannel.name,
                        channelId: targetChannel.id,
                    }),
                    components: [],
                });
                logger.info(
                    `${logPrefix} CONFIRMED via button: Initiating CHANNEL-WIDE message deletion for channel ${targetChannel.id} by ${interaction.user.tag} (${interaction.user.id})`,
                );
            } else if (confirmation.customId === cancelButtonId) {
                await confirmation.update({
                    content: t(locale, 'messageCmd.cancelled'),
                    components: [],
                });
                logger.info(
                    `${logPrefix} Channel-wide deletion cancelled by user ${interaction.user.tag} via button.`,
                );
                return;
            }
        } catch {
            logger.warn(
                `${logPrefix} Channel-wide deletion confirmation timed out for user ${interaction.user.tag}.`,
            );
            await interaction.editReply({
                content: t(locale, 'messageCmd.timeoutCancelled'),
                components: [],
            });
            return;
        }
        // -------------------------------

        const channelToSendResponse = interaction.channel;
        if (!channelToSendResponse || !('send' in channelToSendResponse)) {
            logger.error(
                `${logPrefix} Cannot send response: Interaction channel is not text-based or lacks send permissions.`,
            );
            return;
        }

        const channelStartTime = Date.now(); // Renamed from guildStartTime

        try {
            logger.info(
                `${logPrefix} Starting deletion for channel #${targetChannel.name} (${targetChannel.id})`,
            );
            let channelDeletedCount = 0; // This will be totalDeletedCount
            const channelErrorMessages: string[] = []; // This will be totalErrorMessages
            let lastMessageId: string | undefined = undefined;
            let fetchMore = true;
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

            while (fetchMore) {
                try {
                    const messages: Collection<string, Message> =
                        await targetChannel.messages.fetch({ limit: 100, before: lastMessageId });

                    if (messages.size === 0) {
                        fetchMore = false;
                        break;
                    }

                    lastMessageId = messages.lastKey();
                    const messagesToDelete = new Collection<string, Message>();
                    const oldMessagesToDelete: Message[] = [];

                    for (const message of messages.values()) {
                        if (message.createdTimestamp > twoWeeksAgo) {
                            messagesToDelete.set(message.id, message);
                        } else {
                            oldMessagesToDelete.push(message);
                        }
                    }

                    if (messagesToDelete.size > 0) {
                        try {
                            const deletedResult = await targetChannel.bulkDelete(
                                messagesToDelete,
                                true,
                            );
                            channelDeletedCount += deletedResult.size;
                            logger.debug(
                                `${logPrefix} Bulk deleted ${deletedResult.size} messages.`,
                            );
                            await new Promise((resolve) => setTimeout(resolve, 1100));
                        } catch (error) {
                            const bulkDeleteError = error as Error;
                            logger.error(
                                `${logPrefix} Failed to bulk delete messages:`,
                                bulkDeleteError,
                            );
                            if (!channelErrorMessages.includes('bulk delete failed'))
                                channelErrorMessages.push(
                                    `bulk delete failed (${bulkDeleteError.message})`,
                                );
                        }
                    }

                    if (oldMessagesToDelete.length > 0) {
                        logger.debug(
                            `${logPrefix} Deleting ${oldMessagesToDelete.length} old messages individually...`,
                        );
                        for (const message of oldMessagesToDelete) {
                            let retries = 0;
                            let deletedSuccessfully = false;
                            while (retries < 3 && !deletedSuccessfully) {
                                try {
                                    await message.delete();
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
                                            `${logPrefix} Rate limited deleting old message ${message.id}. Retrying after ${retryAfter}ms... (${retries}/3)`,
                                        );
                                        await interaction
                                            .followUp({
                                                content: t(locale, 'messageCmd.rateLimitRetry', {
                                                    seconds: retryAfter / 1000,
                                                    try: retries,
                                                }),
                                                flags: MessageFlags.Ephemeral,
                                            })
                                            .catch(() => {
                                                /* empty */
                                            });
                                        await new Promise((resolve) =>
                                            setTimeout(resolve, retryAfter + 500),
                                        );
                                    } else {
                                        logger.warn(
                                            `${logPrefix} Failed to delete old message ${message.id}: ${deleteError.message} (Code: ${String(deleteError.code ?? 'unknown')})`,
                                        );
                                        if (
                                            !channelErrorMessages.includes(
                                                `old message ${message.id}`,
                                            )
                                        )
                                            channelErrorMessages.push(
                                                `old message ${message.id} delete failed: ${deleteError.message}`,
                                            );
                                        break;
                                    }
                                }
                            } // end while
                        } // end for
                    } // end if
                    if (messages.size < 100) {
                        fetchMore = false;
                    }
                } catch (error) {
                    const fetchError = error as Error;
                    logger.error(`${logPrefix} Failed to fetch messages:`, fetchError);
                    if (!channelErrorMessages.includes('message fetch error'))
                        channelErrorMessages.push(`message fetch error (${fetchError.message})`);
                    fetchMore = false;
                }
            } // end while(fetchMore)

            const channelEndTime = Date.now(); // Renamed from guildEndTime
            const duration = ((channelEndTime - channelStartTime) / 1000).toFixed(2);

            let finalReportLocalized = t(locale, 'messageCmd.finalDeleteReportChannelAll', {
                userMention: interaction.user.toString(),
                channel: targetChannel.name,
                channelId: targetChannel.id,
                count: channelDeletedCount,
                duration,
            });
            if (channelErrorMessages.length > 0) {
                finalReportLocalized += t(locale, 'messageCmd.errorSummaryHeader', {
                    count: channelErrorMessages.length,
                    errors: channelErrorMessages.slice(0, 10).join('\n- '),
                });
                if (channelErrorMessages.length > 10) {
                    finalReportLocalized += t(locale, 'messageCmd.errorSummaryMore', {
                        count: channelErrorMessages.length - 10,
                    });
                }
            }
            // Send to the channel where the command was invoked
            await channelToSendResponse.send(finalReportLocalized).catch((sendError: unknown) => {
                logger.error(
                    `${logPrefix} Failed to send final CHANNEL deletion report:`,
                    sendError,
                );
            });
            logger.info(
                `${logPrefix} Finished CHANNEL-WIDE message deletion for channel ${targetChannel.id}. Deleted ~${channelDeletedCount} messages with ${channelErrorMessages.length} errors in ${duration}s.`,
            );
        } catch (error) {
            const err = error as Error;
            logger.error(
                `${logPrefix} Critical error during CHANNEL-WIDE message deletion process for channel ${targetChannel.id}:`,
                err,
            );
            const criticalErrorMessage = t(locale, 'messageCmd.criticalDeleteChannelError', {
                userMention: interaction.user.toString(),
                channel: targetChannel.name,
                error: err.message,
            });
            await channelToSendResponse.send(criticalErrorMessage).catch((sendError: unknown) => {
                logger.error(
                    `${logPrefix} Failed to send critical error report for CHANNEL deletion:`,
                    sendError,
                );
            });
        }
    },
};

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
import axios from 'axios';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';
import { storageManager } from '../storage/StorageManager.js';
import { createAttachmentStoragePath } from '../storage/attachmentPath.js';
import type { AttachmentData, SlashCommand } from '../types/commands.js';
import type { MessageReactionSnapshot } from '../types/messageLog.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';

async function downloadWithRetry(url: string, maxRetries = 3): Promise<Buffer> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.debug(`Downloading attachment: ${url} (try ${attempt}/${maxRetries})`);
            const res = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(res.data);
        } catch (err) {
            lastError = err;
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to download ${url} on attempt ${attempt}: ${errorMessage}`);
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw lastError;
}

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('log-channel-messages')
        .setDescription(defaultText('backfill.logChannelDesc'))
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription(defaultText('messageCmd.channelId'))
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
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

        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);

        if (devLevel < 3 && !isAdmin) {
            await interaction.reply({
                content: t(locale, 'common.adminOrDevOnly'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        logger.info(`/log-channel-messages command executed by ${interaction.user.tag}`);

        const targetChannelId = interaction.options.getString('channel_id', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const logPrefix = `[log-channel-messages ${targetChannelId}]`;

        let channel: GuildTextBasedChannel;
        try {
            const fetched = await client.channels.fetch(targetChannelId);
            if (
                !fetched ||
                !fetched.isTextBased() ||
                fetched.isDMBased() ||
                !('guild' in fetched)
            ) {
                await interaction.editReply(
                    t(locale, 'messageCmd.invalidGuildChannel', { channelId: targetChannelId }),
                );
                return;
            }
            channel = fetched as GuildTextBasedChannel;
        } catch (err) {
            logger.error(`${logPrefix} Failed to fetch channel`, err);
            await interaction.editReply(
                t(locale, 'backfill.channelFetchFailed', { channelId: targetChannelId }),
            );
            return;
        }

        const botPerms = channel.permissionsFor(channel.guild.members.me!);
        if (!botPerms?.has(PermissionsBitField.Flags.ReadMessageHistory)) {
            await interaction.editReply(
                t(locale, 'backfill.channelReadDenied', { channel: channel.name }),
            );
            return;
        }

        logger.info(
            `${logPrefix} Starting logging in channel ${channel.id} of guild ${channel.guild.id}`,
        );
        let processed = 0;
        let newlyLogged = 0;
        let lastMessageId: string | undefined = undefined;
        let fetchMore = true;

        while (fetchMore) {
            try {
                const messages: Collection<string, Message> = await channel.messages.fetch({
                    limit: 100,
                    before: lastMessageId,
                });
                if (messages.size === 0) {
                    fetchMore = false;
                    break;
                }
                lastMessageId = messages.lastKey();

                for (const message of messages.values()) {
                    if (message.author.bot) continue;
                    processed++;

                    const processedAttachments: AttachmentData[] = [];
                    if (message.attachments.size > 0) {
                        for (const attachment of message.attachments.values()) {
                            let storagePath: string | null = null;
                            let downloadError: string | null = null;
                            if (config.storage.type) {
                                try {
                                    const fileBuffer = await downloadWithRetry(attachment.url, 3);
                                    const relativePath = createAttachmentStoragePath(
                                        channel.guild.id,
                                        channel.id,
                                        message.id,
                                        attachment.id,
                                        attachment.name,
                                    );
                                    storagePath = await storageManager.upload(
                                        relativePath,
                                        fileBuffer,
                                    );
                                } catch (error) {
                                    const err = error as Error;
                                    downloadError = err.message || 'Unknown error';
                                    logger.error(
                                        `${logPrefix} Failed to process attachment ${attachment.id}`,
                                        err,
                                    );
                                }
                            }
                            processedAttachments.push({
                                id: attachment.id,
                                storagePath,
                                downloadError,
                                filename: attachment.name,
                                size: attachment.size,
                                contentType: attachment.contentType,
                                discordUrl: attachment.url,
                            });
                        }
                    }

                    const reactions: MessageReactionSnapshot[] = message.reactions.cache.map(
                        (r) => ({
                            emojiName: r.emoji.name,
                            emojiId: r.emoji.id,
                            emojiAnimated: r.emoji.animated,
                            count: r.count,
                        }),
                    );

                    const dataToStore = {
                        messageId: message.id,
                        content: message.content,
                        authorTag: message.author.tag,
                        authorUsername: message.author.username,
                        attachments: processedAttachments,
                        stickers: message.stickers.map((s) => ({
                            id: s.id,
                            name: s.name,
                            format: s.format,
                        })),
                        reactions: reactions,
                    };

                    const logged = await logEvent(
                        'messageCreate',
                        channel.guild.id,
                        message.author.id,
                        channel.id,
                        message.id,
                        dataToStore,
                        message.createdAt,
                    );
                    if (logged) newlyLogged++;
                }

                if (messages.size < 100) fetchMore = false;
            } catch (error) {
                const err = error as Error;
                logger.error(`${logPrefix} Failed to fetch messages:`, err);
                await interaction.editReply(
                    t(locale, 'backfill.fetchMessagesFailed', { error: err.message }),
                );
                return;
            }
        }

        await interaction.editReply(
            t(locale, 'backfill.channelDone', {
                channel: channel.name,
                processed,
                newlyLogged,
            }),
        );
        logger.info(
            `${logPrefix} Finished logging. Processed ${processed} messages, newly logged ${newlyLogged}.`,
        );
    },
};

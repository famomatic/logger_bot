import {
    SlashCommandBuilder,
    CommandInteraction,
    PermissionsBitField,
    GuildTextBasedChannel,
    Collection,
    Message,
    Client,
    SlashCommandOptionsOnlyBuilder,
    MessageFlags,
} from 'discord.js';
import axios from 'axios';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { logEvent } from '../db/database.js';
import { storageManager } from '../storage/StorageManager.js';
import { createAttachmentStoragePath } from '../storage/attachmentPath.js';

interface SlashCommand {
    data:
        | SlashCommandOptionsOnlyBuilder
        | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
    execute: (interaction: CommandInteraction, client: Client) => Promise<void>;
}

interface AttachmentData {
    id: string;
    storagePath: string | null;
    downloadError: string | null;
    filename: string;
    size: number;
    contentType: string | null;
    discordUrl: string;
}

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

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('log-channel-messages')
        .setDescription('{channel_id} 채널의 모든 메시지를 확인하여 DB에 기록합니다.')
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription('메시지를 기록할 채널의 ID')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .setDMPermission(false),

    async execute(interaction: CommandInteraction, client: Client) {
        if (!interaction.isChatInputCommand()) return;
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: '이 명령어는 서버 내에서만 사용할 수 있습니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
        const devLevel = config.getDevLevel(interaction.user.id);
        const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);

        if (devLevel < 3 && !isAdmin) {
            await interaction.reply({
                content: '이 명령어는 관리자 또는 개발자만 사용할 수 있습니다.',
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
                    `오류: ID가 ${targetChannelId}인 유효한 서버 채널을 찾을 수 없습니다.`,
                );
                return;
            }
            channel = fetched as GuildTextBasedChannel;
        } catch (err) {
            logger.error(`${logPrefix} Failed to fetch channel`, err);
            await interaction.editReply(
                `채널 ID ${targetChannelId}를 가져오는 중 오류가 발생했습니다.`,
            );
            return;
        }

        const botPerms = channel.permissionsFor(channel.guild.members.me!);
        if (!botPerms?.has(PermissionsBitField.Flags.ReadMessageHistory)) {
            await interaction.editReply(
                `오류: 채널 #${channel.name}의 메시지를 읽을 권한이 없습니다.`,
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

                    const reactions = message.reactions.cache.map((r) => ({
                        emojiName: r.emoji.name,
                        emojiId: r.emoji.id,
                        emojiAnimated: r.emoji.animated,
                        count: r.count,
                    }));

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
                await interaction.editReply(`메시지 조회 중 오류가 발생했습니다: ${err.message}`);
                return;
            }
        }

        await interaction.editReply(
            `✅ 채널 #${channel.name}의 메시지 확인이 완료되었습니다. 총 ${processed}개 중 ${newlyLogged}개가 새로 기록되었습니다.`,
        );
        logger.info(
            `${logPrefix} Finished logging. Processed ${processed} messages, newly logged ${newlyLogged}.`,
        );
    },
};

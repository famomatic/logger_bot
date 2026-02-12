import { Events, Message, Client, Collection, MessageReference } from 'discord.js';
import { logger } from '../utils/logger.js';
import axios, { AxiosError } from 'axios';
import { storageManager } from '../storage/StorageManager.js';
import { createAttachmentStoragePath } from '../storage/attachmentPath.js';
import { config } from '../config/config.js';
import pool, { logEvent, isGuildAuthorized } from '../db/database.js';

logger.debug('messageCreate.ts: Attempting to import query from database.js...');
// import { query } from '../db/database.js'; // Remove query import
logger.debug('messageCreate.ts: Successfully imported logEvent from database.js.');

logger.debug('Executing messageCreate.ts module');

// 첨부파일 다운로드 재시도 로직
async function downloadWithRetry(url: string, maxRetries = 3): Promise<Buffer> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.debug(`Downloading attachment: ${url} (try ${attempt}/${maxRetries})`);
            const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
            return Buffer.from(res.data);
        } catch (err: unknown) {
            lastError = err;
            const message = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to download ${url} on attempt ${attempt}: ${message}`);
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw lastError;
}

// --- 레거시 명령어 타입 임포트 ---
// 파일 내에 정의되어 있으므로 외부 임포트 불필요
interface LegacyCommand {
    name: string;
    execute: (message: Message) => Promise<void>;
}
// --- ---------------------------------------------- ---

// Forward message types (Discord's internal structure for forwarded messages)
interface ForwardedMessageAuthor {
    id?: string;
    username?: string;
    discriminator?: string;
    bot?: boolean;
}

interface ForwardedAttachment {
    id?: string;
    filename?: string;
    content_type?: string;
    contentType?: string;
    size?: number;
    url?: string;
    proxy_url?: string;
    proxyURL?: string;
}

interface ForwardedEmbedFooter {
    text?: string;
    icon_url?: string;
    iconURL?: string;
}

interface ForwardedEmbedImage {
    url?: string;
    proxy_url?: string;
    proxyURL?: string;
    height?: number;
    width?: number;
}

interface ForwardedEmbedAuthor {
    name?: string;
    url?: string;
    icon_url?: string;
    iconURL?: string;
}

interface ForwardedEmbedField {
    name?: string;
    value?: string;
    inline?: boolean;
}

interface ForwardedEmbedProvider {
    name?: string;
    url?: string;
}

interface ForwardedEmbed {
    title?: string;
    description?: string;
    url?: string;
    timestamp?: string;
    color?: number;
    footer?: ForwardedEmbedFooter;
    image?: ForwardedEmbedImage;
    thumbnail?: ForwardedEmbedImage;
    video?: ForwardedEmbedImage;
    author?: ForwardedEmbedAuthor;
    fields?: ForwardedEmbedField[];
    provider?: ForwardedEmbedProvider;
}

interface ForwardedMessage {
    id?: string;
    content?: string;
    author?: ForwardedMessageAuthor;
    attachments?: ForwardedAttachment[];
    embeds?: ForwardedEmbed[];
    timestamp?: string;
    edited_timestamp?: string;
}

// Extend Message to access raw forwarded messages (not in discord.js types)
interface MessageWithForwarded extends Message {
    forwardedMessages?: ForwardedMessage[];
    forwarded_messages?: ForwardedMessage[];
}

interface DbLogRow {
    data: Record<string, unknown>;
}

const BOT_PREFIX = 'logger '; // 고정 접두사 정의

const event = {
    name: Events.MessageCreate as const,
    async execute(
        message: Message,
        client: Client,
        legacyCommands: Collection<string, LegacyCommand>,
    ) {
        // 봇이 보낸 메시지, DM 메시지, 자기 자신 메시지 무시
        if (message.author.bot || !message.guild || client.user?.id === message.author.id) {
            return;
        }

        // --- 레거시 명령어 처리 ---
        const devLevel = config.getDevLevel(message.author.id);
        if (
            devLevel >= 1 &&
            message.content.startsWith(BOT_PREFIX) &&
            legacyCommands &&
            legacyCommands.size > 0
        ) {
            const args = message.content.slice(BOT_PREFIX.length).trim().split(/ +/);
            const commandName = args.shift()?.toLowerCase();

            if (commandName) {
                const command = legacyCommands.get(commandName);
                if (command) {
                    try {
                        // await command.execute(message, args);
                        await command.execute(message);
                        logger.info(
                            `Executed legacy command '${commandName}' by dev: ${message.content}`,
                        );
                    } catch (error) {
                        logger.error(`Error executing legacy command '${commandName}':`, error);
                        await message.reply(
                            `레거시 명령어 실행 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                    return; // 레거시 명령어 실행 시 일반 로깅 건너뛰기
                } else {
                    logger.debug(
                        `Unknown legacy command '${commandName}' tried by dev: ${commandName} (full: ${message.content})`,
                    );
                }
            }
        }
        // --- ------------------- ---

        // 로깅할 데이터 준비
        const eventType = 'messageCreate';
        const guildId = message.guild.id;
        const channelId = message.channel.id;
        const userId = message.author.id;
        const messageId = message.id;
        const timestamp = message.createdAt;

        if (!guildId || !isGuildAuthorized(guildId)) {
            logger.warn(`Unauthorized ${eventType} event logging on guild ${guildId} skipped`);
            return;
        }
        // 첨부 파일 처리 및 정보 추출
        const processedAttachments = [];
        if (message.attachments.size > 0) {
            logger.debug(
                `Processing ${message.attachments.size} attachments for message ${messageId}`,
            );
            for (const attachment of message.attachments.values()) {
                let storagePath: string | null = null;
                let downloadError: string | null = null;

                if (config.storage.type) {
                    // Assumes type is present if we are here
                    try {
                        const fileBuffer = await downloadWithRetry(attachment.url, 3);
                        logger.debug(
                            `Downloaded ${attachment.name ?? 'unnamed'} (${fileBuffer.length} bytes)`,
                        );

                        const relativePath = createAttachmentStoragePath(
                            guildId,
                            channelId,
                            messageId,
                            attachment.id,
                            attachment.name,
                        );
                        storagePath = await storageManager.upload(relativePath, fileBuffer);
                    } catch (error: unknown) {
                        downloadError =
                            error instanceof Error
                                ? error.message
                                : 'Unknown download/upload error';
                        logger.error(
                            `Failed to download/upload attachment ${attachment.id} (${attachment.name ?? 'unnamed'}):`,
                            error,
                        );
                    }
                }

                processedAttachments.push({
                    id: attachment.id,
                    storagePath,
                    downloadError,
                    filename: attachment.name,
                    contentType: attachment.contentType,
                    size: attachment.size,
                    discordUrl: attachment.url,
                });
            }
        }

        // 스티커 정보 추출
        const stickers = message.stickers.map((stk) => ({
            id: stk.id,
            name: stk.name,
            format: stk.format,
        }));

        // 임베드 정보 추출 (일반 메시지용)
        const embeds = message.embeds.map((embed) => ({
            title: embed.title,
            description: embed.description,
            url: embed.url,
            timestamp: embed.timestamp,
            color: embed.color,
            footer: embed.footer
                ? { text: embed.footer.text, iconURL: embed.footer.iconURL }
                : null,
            image: embed.image
                ? {
                      url: embed.image.url,
                      proxyURL: embed.image.proxyURL,
                      height: embed.image.height,
                      width: embed.image.width,
                  }
                : null,
            thumbnail: embed.thumbnail
                ? {
                      url: embed.thumbnail.url,
                      proxyURL: embed.thumbnail.proxyURL,
                      height: embed.thumbnail.height,
                      width: embed.thumbnail.width,
                  }
                : null,
            video: embed.video
                ? {
                      url: embed.video.url,
                      proxyURL: embed.video.proxyURL,
                      height: embed.video.height,
                      width: embed.video.width,
                  }
                : null,
            author: embed.author
                ? { name: embed.author.name, url: embed.author.url, iconURL: embed.author.iconURL }
                : null,
            fields: embed.fields.map((field) => ({
                name: field.name,
                value: field.value,
                inline: field.inline,
            })),
            provider: embed.provider
                ? { name: embed.provider.name, url: embed.provider.url }
                : null,
        }));

        // 전달된 메시지 정보 추출 (message.type === 24 인 경우)
        let forwardedContentData: Record<string, unknown>[] | null = null;
        if ((message.type as number) === 24) {
            // MessageType.Forward equivalent
            const msgWithFwd = message as MessageWithForwarded;
            const rawFwMessages = msgWithFwd.forwardedMessages ?? msgWithFwd.forwarded_messages;
            if (rawFwMessages && Array.isArray(rawFwMessages) && rawFwMessages.length > 0) {
                forwardedContentData = rawFwMessages.map((origMsg: ForwardedMessage) => {
                    const author = origMsg.author ?? {};
                    const fwdAttachments = (origMsg.attachments ?? []).map(
                        (att: ForwardedAttachment) => ({
                            id: att.id,
                            filename: att.filename,
                            contentType: att.content_type ?? att.contentType, // 필드명 불일치 대응
                            size: att.size,
                            url: att.url,
                            proxy_url: att.proxy_url ?? att.proxyURL,
                        }),
                    );
                    const fwdEmbeds = (origMsg.embeds ?? []).map((emb: ForwardedEmbed) => ({
                        title: emb.title,
                        description: emb.description,
                        url: emb.url,
                        timestamp: emb.timestamp,
                        color: emb.color,
                        footer: emb.footer
                            ? {
                                  text: emb.footer.text,
                                  icon_url: emb.footer.icon_url ?? emb.footer.iconURL,
                              }
                            : null,
                        image: emb.image
                            ? {
                                  url: emb.image.url,
                                  proxy_url: emb.image.proxy_url ?? emb.image.proxyURL,
                                  height: emb.image.height,
                                  width: emb.image.width,
                              }
                            : null,
                        thumbnail: emb.thumbnail
                            ? {
                                  url: emb.thumbnail.url,
                                  proxy_url: emb.thumbnail.proxy_url ?? emb.thumbnail.proxyURL,
                                  height: emb.thumbnail.height,
                                  width: emb.thumbnail.width,
                              }
                            : null,
                        video: emb.video
                            ? {
                                  url: emb.video.url,
                                  proxy_url: emb.video.proxy_url ?? emb.video.proxyURL,
                                  height: emb.video.height,
                                  width: emb.video.width,
                              }
                            : null,
                        author: emb.author
                            ? {
                                  name: emb.author.name,
                                  url: emb.author.url,
                                  icon_url: emb.author.icon_url ?? emb.author.iconURL,
                              }
                            : null,
                        fields: (emb.fields ?? []).map((field: ForwardedEmbedField) => ({
                            name: field.name,
                            value: field.value,
                            inline: field.inline,
                        })),
                        provider: emb.provider
                            ? { name: emb.provider.name, url: emb.provider.url }
                            : null,
                    }));
                    return {
                        id: origMsg.id,
                        content: origMsg.content,
                        author: {
                            id: author.id,
                            username: author.username,
                            discriminator: author.discriminator,
                            tag:
                                author.username && author.discriminator
                                    ? `${author.username}#${author.discriminator}`
                                    : author.username,
                            bot: author.bot,
                        },
                        attachments: fwdAttachments,
                        embeds: fwdEmbeds,
                        timestamp: origMsg.timestamp,
                        edited_timestamp: origMsg.edited_timestamp,
                    };
                });
            }
        }

        // 답장/참조된 원본 메시지 정보 추출
        let referencedMessageData: Record<string, unknown> | null = null;
        if (message.reference?.messageId) {
            const refId = message.reference.messageId;
            let refMsg = message.channel.messages.cache.get(refId) ?? null;

            // DB 캐시 조회
            if (!refMsg) {
                try {
                    const res = await pool.query<DbLogRow>(
                        'SELECT data FROM event_logs WHERE guild_id = $1 AND event_type = $2 AND target_id = $3 LIMIT 1',
                        [guildId, 'messageCreate', refId],
                    );
                    if (res.rowCount !== null && res.rowCount > 0) {
                        referencedMessageData = res.rows[0].data;
                    }
                } catch (err) {
                    logger.warn(`DB lookup for referenced message ${refId} failed:`, err);
                }
            }

            // 캐시나 DB에 없으면 API 호출
            if (!referencedMessageData) {
                try {
                    if (!refMsg) {
                        const originalChannel = await client.channels.fetch(
                            message.reference.channelId,
                        );
                        if (
                            originalChannel &&
                            (originalChannel.isTextBased() || originalChannel.isDMBased())
                        ) {
                            refMsg = await originalChannel.messages.fetch(refId);
                        }
                    }

                    if (refMsg) {
                        referencedMessageData = {
                            id: refMsg.id,
                            content: refMsg.content,
                            author: {
                                id: refMsg.author.id,
                                tag: refMsg.author.tag,
                                username: refMsg.author.username,
                                bot: refMsg.author.bot,
                            },
                            attachments: refMsg.attachments.map((att) => ({
                                id: att.id,
                                filename: att.name,
                                contentType: att.contentType,
                                size: att.size,
                                url: att.url,
                                proxyURL: att.proxyURL,
                            })),
                            embeds: refMsg.embeds.map((emb) => ({
                                title: emb.title,
                                description: emb.description,
                                url: emb.url,
                            })),
                            timestamp: refMsg.createdAt.toISOString(),
                            editedTimestamp: refMsg.editedAt ? refMsg.editedAt.toISOString() : null,
                        };
                    }
                } catch (error: unknown) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    const errCode =
                        error instanceof AxiosError
                            ? error.code
                            : error instanceof Error
                              ? (error as { code?: string }).code
                              : undefined;
                    logger.warn(`Failed to fetch referenced message ${refId}: ${errMsg}`);
                    referencedMessageData = {
                        error: `Failed to fetch: ${errMsg}`,
                        errorCode: errCode,
                        originalMessageId: refId,
                        originalChannelId: message.reference.channelId,
                    };
                }
            }
        }

        // 데이터베이스에 저장할 JSON 데이터
        const dataToStore: Record<string, unknown> = {
            messageId: messageId,
            content: message.content,
            authorTag: message.author.tag,
            authorUsername: message.author.username,
            attachments: processedAttachments,
            stickers: stickers,
            embeds: embeds,
            messageType: message.type,
            forwardedContentList: forwardedContentData,
            referencedMessage: referencedMessageData, // 답장/참조된 원본 메시지 정보 추가
            rawReference: message.reference
                ? {
                      channelId: message.reference.channelId,
                      messageId: message.reference.messageId,
                      guildId: message.reference.guildId,
                      type: (message.reference as MessageReference & { type?: unknown }).type,
                  }
                : null,
        };

        try {
            // await query(insertQuery, values);
            // Call logEvent instead
            await logEvent(
                eventType,
                guildId,
                userId,
                channelId,
                messageId,
                dataToStore,
                timestamp,
            );
            logger.debug(`Logged ${eventType} event for message ${messageId} in guild ${guildId}`);
        } catch (error) {
            // logEvent 내부에서 에러 로깅이 이미 수행됨.
            logger.error(
                `Error occurred while trying to log ${eventType} event for message ${messageId}:`,
                error,
            );
        }
    },
} as const;

export default event;

import type { AttachmentData } from './commands.js';
import type { Message } from 'discord.js';

export interface MessageReactionSnapshot {
    emojiName: string | null;
    emojiId: string | null;
    emojiAnimated: boolean | null;
    count: number;
}

export interface ForwardedMessageAuthor {
    id?: string;
    username?: string;
    discriminator?: string;
    bot?: boolean;
}

export interface ForwardedAttachment {
    id?: string;
    filename?: string;
    content_type?: string;
    contentType?: string;
    size?: number;
    url?: string;
    proxy_url?: string;
    proxyURL?: string;
}

export interface ForwardedEmbedFooter {
    text?: string;
    icon_url?: string;
    iconURL?: string;
}

export interface ForwardedEmbedImage {
    url?: string;
    proxy_url?: string;
    proxyURL?: string;
    height?: number;
    width?: number;
}

export interface ForwardedEmbedAuthor {
    name?: string;
    url?: string;
    icon_url?: string;
    iconURL?: string;
}

export interface ForwardedEmbedField {
    name?: string;
    value?: string;
    inline?: boolean;
}

export interface ForwardedEmbedProvider {
    name?: string;
    url?: string;
}

export interface ForwardedEmbed {
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

export interface ForwardedMessage {
    id?: string;
    content?: string;
    author?: ForwardedMessageAuthor;
    attachments?: ForwardedAttachment[];
    embeds?: ForwardedEmbed[];
    timestamp?: string;
    edited_timestamp?: string;
}

export interface MessageWithForwarded extends Message {
    forwardedMessages?: ForwardedMessage[];
    forwarded_messages?: ForwardedMessage[];
}

export interface DbLogRow {
    data: Record<string, unknown>;
}

export interface BuildMessageCreateDataParams {
    message: Message;
    attachments: AttachmentData[];
    reactions?: MessageReactionSnapshot[];
    embeds?: Record<string, unknown>[];
    forwardedContentList?: Record<string, unknown>[] | null;
    referencedMessage?: Record<string, unknown> | null;
    rawReference?: Record<string, unknown> | null;
}

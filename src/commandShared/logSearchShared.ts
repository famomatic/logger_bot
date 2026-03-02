import {
    ChatInputCommandInteraction,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SectionBuilder,
    MessageFlags,
    SeparatorBuilder,
    FileBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageComponentInteraction,
    InteractionEditReplyOptions,
    MessageActionRowComponentBuilder,
    InteractionReplyOptions,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { getFriendlyEventName } from '../config/eventsConfig.js';
import { searchLogs } from '../db/database.js';
import { storageManager } from '../storage/StorageManager.js';
import { buildContainerMessage } from './componentsV2.js';
import type { JsonData } from '../types/json.js';
import type { AttachmentLogData } from '../types/logs.js';
import { MAX_TEXT_SIZE, PAGE_SIZE, getLogSearchMessages } from './logSearchShared/constants.js';
import { str } from './logSearchShared/formatters.js';
import { renderEvent as renderMessageEvent } from './logSearchShared/renderers/message.js';
import { renderEvent as renderMemberEvent } from './logSearchShared/renderers/member.js';
import { renderEvent as renderRoleEvent } from './logSearchShared/renderers/role.js';
import { renderEvent as renderStickerEvent } from './logSearchShared/renderers/sticker.js';
import { renderEvent as renderEmojiEvent } from './logSearchShared/renderers/emoji.js';
import { renderEvent as renderVoiceStateUpdateEvent } from './logSearchShared/renderers/voice.js';
import { renderGuildEvent } from './logSearchShared/renderers/guild.js';
import { renderScheduledEvent } from './logSearchShared/renderers/scheduledEvent.js';
import { renderInviteEvent } from './logSearchShared/renderers/invite.js';
import { renderChannelEvent } from './logSearchShared/renderers/channel.js';
import { renderThreadEvent } from './logSearchShared/renderers/thread.js';
import { renderUserEvent } from './logSearchShared/renderers/user.js';
import { getInteractionLocale, t } from '../i18n/index.js';

/** 로그 검색 명령에서 날짜 파서를 재사용할 수 있도록 re-export 합니다. */
export { parseDateString } from './logSearchShared/date.js';

/**
 * 로그 검색 결과를 페이지 단위로 조회해 Components V2 UI(본문/첨부/페이지 버튼)로 렌더링합니다.
 */
export async function fetchAndDisplayLogs(
    interaction: ChatInputCommandInteraction | MessageComponentInteraction,
    currentOffset: number,
    searchParams: {
        // 검색 조건을 담는 객체
        guildId: string;
        userId?: string;
        channelId?: string;
        startDate?: Date;
        endDate?: Date;
        eventType?: string;
        noOptionsProvidedInitially: boolean;
    },
    includeCloseButton = false,
    currentPage: number = Math.floor(currentOffset / PAGE_SIZE),
) {
    const locale = getInteractionLocale(interaction);
    const logSearchMessages = getLogSearchMessages(locale);
    const {
        guildId,
        userId,
        channelId,
        startDate,
        endDate,
        eventType,
        noOptionsProvidedInitially,
    } = searchParams;

    try {
        const { logs, totalCount } = await searchLogs({
            guildId: guildId,
            userId: userId,
            channelId: channelId,
            startDate: startDate,
            endDate: endDate,
            eventType: eventType,
            limit: PAGE_SIZE,
            offset: currentOffset,
        });

        const editReplyOptions: InteractionEditReplyOptions = {
            components: [],
            files: [],
            allowedMentions: { parse: [] }, // Disable all forms of parsing mentions
        };

        if (totalCount === 0) {
            await interaction.editReply(
                buildContainerMessage({
                    title:
                        noOptionsProvidedInitially && currentOffset === 0
                            ? logSearchMessages.noRecentLogsTitle
                            : logSearchMessages.noSearchResultsTitle,
                    description:
                        noOptionsProvidedInitially && currentOffset === 0
                            ? logSearchMessages.noRecentLogsDescription
                            : logSearchMessages.noSearchResultsDescription,
                    accentColor: 0xed4245,
                }),
            );
            return;
        }

        // 디스플레이용 컴포넌트들 (ActionRow로 감싸지 않음)
        const displayableComponents: (
            | TextDisplayBuilder
            | SectionBuilder
            | SeparatorBuilder
            | FileBuilder
        )[] = [];
        const attachmentsToSend: AttachmentBuilder[] = [];

        // Create a TextDisplayBuilder for the summary message (formerly content)
        const summaryPrefix =
            noOptionsProvidedInitially && currentOffset === 0 && totalCount > 0
                ? logSearchMessages.summaryRecentPrefix
                : logSearchMessages.summarySearchPrefix;
        const summaryMessage = t(locale, 'logSearchShared.showingCount', {
            prefix: summaryPrefix,
            total: totalCount,
            shown: logs.length,
        });
        const summaryBuilder = new TextDisplayBuilder().setContent(summaryMessage);
        displayableComponents.push(summaryBuilder);
        displayableComponents.push(new SeparatorBuilder()); // Add a separator after the summary
        let currentTextSize = summaryMessage.length;
        let logsDisplayed = 0;

        for (const log of logs) {
            let thumbnailComponent;
            try {
                const logUser = log.user_id
                    ? await interaction.client.users.fetch(log.user_id)
                    : null;
                thumbnailComponent = new ThumbnailBuilder({
                    media: {
                        url:
                            logUser?.displayAvatarURL({ forceStatic: false, size: 64 }) ??
                            `https://cdn.discordapp.com/embed/avatars/${parseInt(log.user_id ?? '0') % 5}.png`,
                    },
                });
            } catch {
                thumbnailComponent = new ThumbnailBuilder({
                    media: { url: `https://cdn.discordapp.com/embed/avatars/0.png` },
                });
            }

            const timestampContent = `<t:${Math.floor(new Date(log.timestamp).getTime() / 1000)}:F>`;
            const timestampText = new TextDisplayBuilder().setContent(timestampContent);
            let eventSpecificsText = t(locale, 'logSearchShared.emptyContent');

            if (log.event_data && typeof log.event_data === 'object') {
                const data = log.event_data as JsonData;
                switch (log.event_type) {
                    case 'messageCreate':
                    case 'messageDelete':
                    case 'messageUpdate': {
                        eventSpecificsText = renderMessageEvent({
                            eventType: log.event_type,
                            eventData: data,
                            locale,
                        });
                        break;
                    }
                    case 'guildMemberAdd':
                    case 'guildMemberRemove':
                    case 'guildMemberUpdate': {
                        const renderedMemberEvent = await renderMemberEvent({
                            interaction,
                            log,
                            eventType: log.event_type,
                            eventData: data,
                            thumbnailComponent,
                        });
                        eventSpecificsText = renderedMemberEvent.eventSpecificsText;
                        thumbnailComponent = renderedMemberEvent.thumbnailComponent;
                        break;
                    }

                    case 'guildRoleCreate':
                    case 'guildRoleUpdate':
                    case 'guildRoleDelete': {
                        const renderedRoleEvent = await renderRoleEvent({
                            interaction,
                            log,
                            eventType: log.event_type,
                            eventData: data,
                            thumbnailComponent,
                        });
                        eventSpecificsText = renderedRoleEvent.eventSpecificsText;
                        thumbnailComponent = renderedRoleEvent.thumbnailComponent;
                        break;
                    }
                    // STICKER EVENTS
                    case 'stickerCreate':
                    case 'stickerUpdate':
                    case 'stickerDelete': {
                        const stickerRender = await renderStickerEvent({
                            eventType: log.event_type,
                            data,
                            interaction,
                            logUserId: log.user_id,
                            currentThumbnail: thumbnailComponent,
                        });
                        eventSpecificsText = stickerRender.eventSpecificsText;
                        if (stickerRender.thumbnailComponent) {
                            thumbnailComponent = stickerRender.thumbnailComponent;
                        }
                        break;
                    }

                    // EMOJI EVENTS
                    case 'emojiCreate':
                    case 'emojiUpdate':
                    case 'emojiDelete': {
                        const emojiRender = await renderEmojiEvent({
                            eventType: log.event_type,
                            data,
                            interaction,
                            logUserId: log.user_id,
                        });
                        eventSpecificsText = emojiRender.eventSpecificsText;
                        if (emojiRender.thumbnailComponent) {
                            thumbnailComponent = emojiRender.thumbnailComponent;
                        }
                        break;
                    }

                    // GUILD BAN EVENTS
                    case 'guildBanAdd':
                    case 'guildBanRemove':
                    case 'guildUpdate': {
                        const guildRender = await renderGuildEvent({
                            eventType: log.event_type,
                            eventData: data,
                            interaction,
                            logUserId: log.user_id,
                        });
                        eventSpecificsText = guildRender.eventSpecificsText;
                        if (guildRender.thumbnailComponent) {
                            thumbnailComponent = guildRender.thumbnailComponent;
                        }
                        break;
                    }

                    // GUILD SCHEDULED EVENT
                    case 'guildScheduledEventCreate':
                    case 'guildScheduledEventUpdate':
                    case 'guildScheduledEventDelete':
                    case 'guildScheduledEventUserAdd':
                    case 'guildScheduledEventUserRemove': {
                        const scheduledEventRender = await renderScheduledEvent({
                            eventType: log.event_type,
                            eventData: data,
                            interaction,
                            logUserId: log.user_id,
                        });
                        eventSpecificsText = scheduledEventRender.eventSpecificsText;
                        if (scheduledEventRender.thumbnailComponent) {
                            thumbnailComponent = scheduledEventRender.thumbnailComponent;
                        }
                        break;
                    }

                    // INVITE EVENTS
                    case 'inviteCreate':
                    case 'inviteDelete': {
                        const inviteRender = await renderInviteEvent({
                            eventType: log.event_type,
                            eventData: data,
                            interaction,
                            logUserId: log.user_id,
                        });
                        eventSpecificsText = inviteRender.eventSpecificsText;
                        if (inviteRender.thumbnailComponent) {
                            thumbnailComponent = inviteRender.thumbnailComponent;
                        }
                        break;
                    }

                    // CHANNEL EVENTS (TEXT, VOICE, CATEGORY, ETC.)
                    case 'channelCreate':
                    case 'channelDelete':
                    case 'channelUpdate':
                    case 'channelPinsUpdate': {
                        const channelRender = await renderChannelEvent({
                            eventType: log.event_type,
                            eventData: data,
                            interaction,
                            logUserId: log.user_id,
                        });
                        eventSpecificsText = channelRender.eventSpecificsText;
                        if (channelRender.thumbnailComponent) {
                            thumbnailComponent = channelRender.thumbnailComponent;
                        }
                        break;
                    }

                    // THREAD EVENTS
                    case 'threadCreate':
                    case 'threadDelete':
                    case 'threadUpdate': {
                        const threadRender = await renderThreadEvent({
                            eventType: log.event_type,
                            eventData: data,
                            interaction,
                            logUserId: log.user_id,
                        });
                        eventSpecificsText = threadRender.eventSpecificsText;
                        if (threadRender.thumbnailComponent) {
                            thumbnailComponent = threadRender.thumbnailComponent;
                        }
                        break;
                    }

                    // USER UPDATE (e.g. username, avatar)
                    case 'userUpdate': {
                        const userRender = await renderUserEvent({
                            eventType: log.event_type,
                            eventData: data,
                            interaction,
                            logUserId: log.user_id,
                        });
                        eventSpecificsText = userRender.eventSpecificsText;
                        if (userRender.thumbnailComponent) {
                            thumbnailComponent = userRender.thumbnailComponent;
                        }
                        break;
                    }
                    // VOICE STATE UPDATE
                    case 'voiceStateUpdate': {
                        const voiceRender = await renderVoiceStateUpdateEvent({
                            data,
                            interaction,
                        });
                        eventSpecificsText = voiceRender.eventSpecificsText;
                        if (voiceRender.thumbnailComponent) {
                            thumbnailComponent = voiceRender.thumbnailComponent;
                        }
                        break;
                    }
                    default:
                        // 기본적으로 event_data를 JSON 문자열로 표시하거나, 간단한 텍스트로 변환
                        if (Object.keys(data).length > 0) {
                            eventSpecificsText = `\`\`\`json\n${JSON.stringify(data, null, 2)}\`\`\``;
                            if (eventSpecificsText.length > 750) {
                                // 너무 길면 자르기
                                eventSpecificsText =
                                    eventSpecificsText.substring(0, 750) + '...```';
                            }
                        } else {
                            eventSpecificsText = t(locale, 'logSearchShared.emptyDetails');
                        }
                        break;
                }
            }
            const friendlyEventName = getFriendlyEventName(log.event_type, locale);

            const infoTextContent =
                `${t(locale, 'logSearchShared.eventLabel', {
                    name: friendlyEventName,
                    type: log.event_type,
                })}\n` +
                `${log.channel_id ? `${t(locale, 'logSearchShared.channelLabel', { channelId: log.channel_id })}\n` : ''}` +
                // guildMemberAdd/Remove의 경우 사용자 정보는 eventSpecificsText에서 더 자세히 다룸
                // 그 외 이벤트는 기존 방식 유지
                (!['guildMemberAdd', 'guildMemberRemove'].includes(log.event_type) && log.user_id
                    ? `${t(locale, 'logSearchShared.userLabel', { userId: log.user_id })}\n`
                    : !['guildMemberAdd', 'guildMemberRemove'].includes(log.event_type)
                      ? `${t(locale, 'logSearchShared.systemUserLabel')}\n`
                      : '') +
                t(locale, 'logSearchShared.contentLabel', { value: eventSpecificsText });
            const infoContentString = infoTextContent.substring(0, 2000);
            const infoText = new TextDisplayBuilder().setContent(infoContentString); // Max length for text display

            const sectionComponent = new SectionBuilder()
                .addTextDisplayComponents(timestampText, infoText)
                .setThumbnailAccessory(thumbnailComponent);

            const logTextSize = timestampContent.length + infoContentString.length;

            if (currentTextSize + logTextSize > MAX_TEXT_SIZE) {
                break;
            }

            currentTextSize += logTextSize;
            displayableComponents.push(sectionComponent);
            logsDisplayed++;

            const eventData = log.event_data as JsonData & { attachments?: AttachmentLogData[] };
            if (eventData && Array.isArray(eventData.attachments)) {
                for (const item of eventData.attachments) {
                    const attachmentData = item;
                    const storagePath = str(attachmentData.storagePath);
                    if (storagePath && attachmentData.filename) {
                        let nasFileBuffer: Buffer | null = null;
                        try {
                            nasFileBuffer = await storageManager.download(storagePath);
                        } catch {
                            // Suppress error if file not found or download failed, similar to previous behavior
                            // logger.warn(`Failed to download attachment: ${attachmentData.storagePath}`, error);
                        }
                        if (nasFileBuffer) {
                            const uniqueAttachmentFilename =
                                `${log.id}_${str(attachmentData.id)}_${str(attachmentData.filename)}`.replace(
                                    /[^a-zA-Z0-9_.-]/g,
                                    '_',
                                );
                            const discordAttachment = new AttachmentBuilder(nasFileBuffer, {
                                name: uniqueAttachmentFilename,
                            });
                            attachmentsToSend.push(discordAttachment);
                            const fileComponent = new FileBuilder().setURL(
                                `attachment://${uniqueAttachmentFilename}`,
                            );
                            displayableComponents.push(fileComponent);
                        } else if (attachmentData.discordUrl) {
                            const attText = `📎 [${str(attachmentData.filename) || t(locale, 'logSearchShared.attachmentDownloadFail')}](${str(attachmentData.discordUrl)})`;
                            if (currentTextSize + attText.length > MAX_TEXT_SIZE) break;
                            currentTextSize += attText.length;
                            displayableComponents.push(
                                new TextDisplayBuilder().setContent(attText),
                            );
                        }
                    } else if (attachmentData.discordUrl) {
                        const attText = `📎 [${str(attachmentData.filename) || t(locale, 'logSearchShared.attachment')}](${str(attachmentData.discordUrl)})`;
                        if (currentTextSize + attText.length > MAX_TEXT_SIZE) break;
                        currentTextSize += attText.length;
                        displayableComponents.push(new TextDisplayBuilder().setContent(attText));
                    }
                }
            }
            if (logs.indexOf(log) < logs.length - 1) {
                displayableComponents.push(new SeparatorBuilder());
            }
        }

        summaryBuilder.setContent(
            t(locale, 'logSearchShared.showingCount', {
                prefix: summaryPrefix,
                total: totalCount,
                shown: logsDisplayed,
            }),
        );

        if (displayableComponents.length <= 1 && totalCount > 0 && attachmentsToSend.length === 0) {
            // <= 1 because we added summary and separator
            displayableComponents.push(
                new TextDisplayBuilder().setContent(logSearchMessages.renderFailureMessage),
            );
        }

        const prevOffset = Math.max(0, currentOffset - PAGE_SIZE);
        const prevButton = new ButtonBuilder()
            .setCustomId(`log_search_prev_${prevOffset}_${currentPage - 1}`)
            .setLabel(t(locale, 'logSearchShared.prev'))
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0);

        const nextOffset = currentOffset + logsDisplayed;
        const nextButton = new ButtonBuilder()
            .setCustomId(`log_search_next_${nextOffset}_${currentPage + 1}`)
            .setLabel(t(locale, 'logSearchShared.next'))
            .setStyle(ButtonStyle.Primary)
            .setDisabled(nextOffset >= totalCount);

        const pageInfo = new ButtonBuilder()
            .setCustomId('log_search_pageinfo')
            .setLabel(
                t(locale, 'logSearchShared.page', {
                    current: currentPage + 1,
                    total: Math.ceil(totalCount / PAGE_SIZE),
                }),
            )
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);

        let buttonActionRow =
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                prevButton,
                pageInfo,
                nextButton,
            );
        if (includeCloseButton) {
            const closeButton = new ButtonBuilder()
                .setCustomId('log_search_close')
                .setLabel(t(locale, 'logSearchShared.close'))
                .setStyle(ButtonStyle.Danger);
            buttonActionRow =
                new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                    prevButton,
                    pageInfo,
                    nextButton,
                    closeButton,
                );
        }

        editReplyOptions.flags = MessageFlags.IsComponentsV2;
        editReplyOptions.components = [...displayableComponents, buttonActionRow];
        editReplyOptions.files = attachmentsToSend;

        await interaction.editReply(editReplyOptions);
        logger.info(
            `Sent logs (offset: ${currentOffset}, limit: ${PAGE_SIZE}, total: ${totalCount}) with V2 components and pagination for ${interaction.user.tag}`,
        );
    } catch (error) {
        logger.error('Error during fetchAndDisplayLogs:', error);
        const errorReplyOptions: InteractionEditReplyOptions = {
            ...buildContainerMessage({
                title: logSearchMessages.genericErrorTitle,
                description: logSearchMessages.genericErrorDescription,
                accentColor: 0xed4245,
            }),
            files: [],
        };

        if (interaction.replied || interaction.deferred) {
            try {
                await interaction.editReply(errorReplyOptions);
            } catch (editError) {
                logger.error(
                    'Failed to send error embed via editReply after initial reply/defer:',
                    editError,
                );
            }
        } else {
            try {
                const replyOptionsForInitialError: InteractionReplyOptions = {
                    components: errorReplyOptions.components,
                    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] }, // Also apply to initial error replies
                };
                if (errorReplyOptions.files && errorReplyOptions.files.length > 0) {
                    replyOptionsForInitialError.files = errorReplyOptions.files;
                }
                await interaction.reply(replyOptionsForInitialError);
            } catch (replyError) {
                logger.error(
                    'Failed to send error reply for ChatInputCommandInteraction:',
                    replyError,
                );
            }
        }
    }
}

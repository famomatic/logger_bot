import {
    SlashCommandBuilder,
    PermissionsBitField,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';

import { ensureSlashCommandPermission } from '../commandShared/slashPermission.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import { processMessageCreateLog } from '../services/logGuildMessagesService.js';
import { logger } from '../utils/logger.js';

import type { SlashCommand } from '../types/commands.js';
import type {
    CommandInteraction,
    GuildTextBasedChannel,
    Collection,
    Message,
    Client,
} from 'discord.js';

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
        .addIntegerOption((option) =>
            option
                .setName('max_pages')
                .setDescription(defaultText('backfill.maxPagesOptionDesc'))
                .setMinValue(1)
                .setRequired(false),
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

        logger.info(`/log-channel-messages command executed by ${interaction.user.tag}`);

        const targetChannelId = interaction.options.getString('channel_id', true);
        const maxPages = interaction.options.getInteger('max_pages');
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
            channel = fetched;
        } catch (err) {
            logger.error(`${logPrefix} Failed to fetch channel`, err);
            await interaction.editReply(
                t(locale, 'backfill.channelFetchFailed', { channelId: targetChannelId }),
            );
            return;
        }

        const botPerms = channel.permissionsFor(channel.guild.members.me!);
        if (!botPerms.has(PermissionsBitField.Flags.ReadMessageHistory)) {
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
        let scannedPages = 0;

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
                scannedPages++;
                lastMessageId = messages.lastKey();

                for (const message of messages.values()) {
                    if (message.author.bot) continue;
                    processed++;

                    const logged = await processMessageCreateLog(
                        channel.guild.id,
                        channel.id,
                        message,
                    );
                    if (logged) newlyLogged++;
                }

                if (maxPages !== null && scannedPages >= maxPages) {
                    fetchMore = false;
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
            `${logPrefix} Finished logging. Processed ${processed} messages, newly logged ${newlyLogged}, scanned pages ${scannedPages}${maxPages !== null ? ` (maxPages=${maxPages})` : ''}.`,
        );
    },
};

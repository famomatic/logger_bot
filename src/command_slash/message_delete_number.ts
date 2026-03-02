import {
    SlashCommandBuilder,
    CommandInteraction,
    PermissionsBitField,
    Client,
    GuildTextBasedChannel,
    Collection,
    Message,
    MessageFlags,
    InteractionContextType,
} from 'discord.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import type { SlashCommand } from '../types/commands.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-delete-number')
        .setDescription(defaultText('messageCmd.deleteNumberDesc'))
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription(defaultText('messageCmd.channelId'))
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName('amount')
                .setDescription(defaultText('messageCmd.amount'))
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

        logger.info(`/message-delete-number command executed by ${interaction.user.tag}`);

        const channelId = interaction.options.getString('channel_id', true);
        const amount = interaction.options.getInteger('amount', true);
        if (amount <= 0) {
            await interaction.reply({
                content: t(locale, 'messageCmd.amountMin'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (amount > 100) {
            await interaction.reply({
                content: t(locale, 'messageCmd.amountMax'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const logPrefix = `[message-delete-number ${channelId}]`;

        let channel: GuildTextBasedChannel;
        try {
            const fetched = await client.channels.fetch(channelId);
            if (
                !fetched ||
                !fetched.isTextBased() ||
                fetched.isDMBased() ||
                !('guild' in fetched)
            ) {
                await interaction.editReply(
                    t(locale, 'messageCmd.invalidGuildChannel', { channelId }),
                );
                return;
            }
            channel = fetched as GuildTextBasedChannel;
        } catch (err) {
            logger.error(`${logPrefix} Failed to fetch channel`, err);
            await interaction.editReply(t(locale, 'messageCmd.fetchChannelFailed'));
            return;
        }

        const botPerms = channel.permissionsFor(channel.guild.members.me!);
        if (
            !botPerms?.has(PermissionsBitField.Flags.ReadMessageHistory) ||
            !botPerms?.has(PermissionsBitField.Flags.ManageMessages)
        ) {
            await interaction.editReply(
                t(locale, 'messageCmd.noDeletePermission', { channel: channel.name }),
            );
            return;
        }

        try {
            const fetchedMessages = await channel.messages.fetch({ limit: amount });
            const messagesToDelete = new Collection<string, Message>();
            const oldMessages: Message[] = [];
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

            for (const msg of fetchedMessages.values()) {
                if (msg.createdTimestamp > twoWeeksAgo) messagesToDelete.set(msg.id, msg);
                else oldMessages.push(msg);
            }

            let deletedCount = 0;
            if (messagesToDelete.size > 0) {
                const result = await channel.bulkDelete(messagesToDelete, true);
                deletedCount += result.size;
            }

            for (const msg of oldMessages) {
                try {
                    await msg.delete();
                    deletedCount++;
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    logger.warn(`${logPrefix} Failed to delete old message ${msg.id}:`, error);
                }
            }

            await interaction.editReply(
                t(locale, 'messageCmd.deletedCount', {
                    channel: channel.name,
                    count: deletedCount,
                }),
            );
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.error(`${logPrefix} Failed to delete messages:`, error);
            await interaction.editReply(
                t(locale, 'messageCmd.genericError', { error: error.message }),
            );
        }
    },
};

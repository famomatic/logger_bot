import {
    SlashCommandBuilder,
    CommandInteraction,
    PermissionsBitField,
    Client,
    GuildTextBasedChannel,
    Collection,
    Message,
    MessageFlags,
} from 'discord.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import type { SlashCommand } from '../types/commands.js';

export const command: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('message-delete-number')
        .setDescription('지정한 채널에서 최근 N개의 메시지를 삭제합니다.')
        .addStringOption((option) =>
            option
                .setName('channel_id')
                .setDescription('메시지를 삭제할 채널의 ID')
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option.setName('amount').setDescription('삭제할 메시지 수 (1-100)').setRequired(true),
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

        logger.info(`/message-delete-number command executed by ${interaction.user.tag}`);

        const channelId = interaction.options.getString('channel_id', true);
        const amount = interaction.options.getInteger('amount', true);
        if (amount <= 0) {
            await interaction.reply({
                content: '삭제할 메시지 수는 1 이상이어야 합니다.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (amount > 100) {
            await interaction.reply({
                content: '한 번에 최대 100개의 메시지만 삭제할 수 있습니다.',
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
                    `오류: ID가 ${channelId}인 유효한 서버 채널을 찾을 수 없습니다.`,
                );
                return;
            }
            channel = fetched as GuildTextBasedChannel;
        } catch (err) {
            logger.error(`${logPrefix} Failed to fetch channel`, err);
            await interaction.editReply('채널 정보를 가져오는 중 오류가 발생했습니다.');
            return;
        }

        const botPerms = channel.permissionsFor(channel.guild.members.me!);
        if (
            !botPerms?.has(PermissionsBitField.Flags.ReadMessageHistory) ||
            !botPerms?.has(PermissionsBitField.Flags.ManageMessages)
        ) {
            await interaction.editReply(
                `오류: 채널 #${channel.name}에서 메시지를 삭제할 권한이 없습니다.`,
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
                `✅ 채널 #${channel.name}에서 ${deletedCount}개의 메시지를 삭제했습니다.`,
            );
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.error(`${logPrefix} Failed to delete messages:`, error);
            await interaction.editReply(`오류 발생: ${error.message}`);
        }
    },
};

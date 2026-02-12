import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField, ChannelType, MessageFlags, GuildTextBasedChannel } from 'discord.js';
import { config } from '../config/config.js';
import { removeSubscription, categoryEventMap } from '../utils/alertManager.js';
import { logger } from '../utils/logger.js';

const choices = Object.keys(categoryEventMap).map(cat => ({ name: cat, value: cat })).slice(0, 25);

export const command = {
  data: new SlashCommandBuilder()
    .setName('log-alert-remove')
    .setDescription('특정 이벤트 카테고리 알림을 채널에서 제거합니다.')
    .addStringOption(o => o.setName('event_type').setDescription('이벤트 카테고리').setRequired(true).addChoices(...choices))
    .addChannelOption(o => o.setName('channel').setDescription('알림을 제거할 채널').setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread))
    .setDMPermission(false),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: '이 명령어는 서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
      return;
    }
    const memberPermissions = interaction.member?.permissions as Readonly<PermissionsBitField>;
    const devLevel = config.getDevLevel(interaction.user.id);
    const isAdmin = memberPermissions?.has(PermissionsBitField.Flags.Administrator);
    if (devLevel < 2 && !isAdmin) {
      await interaction.reply({ content: '이 명령어는 레벨2 이상 개발자 또는 관리자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
      return;
    }
    const category = interaction.options.getString('event_type', true);
    const optionChannel = interaction.options.getChannel('channel', true);
    if (!('isTextBased' in optionChannel) || !optionChannel.isTextBased()) {
      await interaction.reply({ content: '텍스트 채널만 지정할 수 있습니다.', flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = optionChannel as GuildTextBasedChannel;
    const removed = removeSubscription(interaction.guildId, category, channel.id);
    if (!removed) {
      await interaction.reply({ content: '해당 카테고리 알림이 이 채널에 설정되어 있지 않습니다.', flags: MessageFlags.Ephemeral });
      return;
    }
    logger.info(`/log-alert-remove by ${interaction.user.tag} in guild ${interaction.guildId} for category ${category} channel ${channel.id}`);
    await interaction.reply({ content: `${channel.toString()} 채널에서 ${category} 이벤트 알림을 제거했습니다.`, flags: MessageFlags.Ephemeral });
  }
};

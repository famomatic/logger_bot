import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Events,
    PermissionsBitField,
    MessageFlags,
} from 'discord.js';
import dotenv from 'dotenv';
import { loadLegacyCommands, unloadLegacyCommands } from '../utils/loadLegacyCommands.js';
import {
    loadSlashCommands,
    unloadSlashCommands,
    SlashCommand,
} from '../utils/loadSlashCommands.js';
import { loadEvents, unloadEvents } from '../utils/loadEvents.js';
import { logger } from '../utils/logger.js';
import { config, reloadConfig } from '../config/config.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('봇의 명령어 및 이벤트를 다시 로드합니다.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator), // 관리자만 사용 가능하도록 설정

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        // 개발자 또는 관리자 권한 확인
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

        logger.info(`/reload command executed by ${interaction.user.tag}`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            dotenv.config({ override: true });
            reloadConfig();
            unloadLegacyCommands(client);
            await loadLegacyCommands(client);
            unloadSlashCommands(client);
            await loadSlashCommands(client);
            unloadEvents(client);
            await loadEvents(client);
            client.on(Events.InteractionCreate, (i) => {
                void (async () => {
                    if (!i.isChatInputCommand()) return;
                    const commandClient = client as Client & {
                        commands?: Map<string, SlashCommand>;
                    };
                    const cmd = commandClient.commands?.get(i.commandName);
                    if (!cmd) return;
                    try {
                        await cmd.execute(i, client);
                    } catch (err) {
                        logger.error(`Error executing command ${i.commandName}:`, err);
                    }
                })();
            });
            await interaction.editReply('🔄 봇이 성공적으로 리로드되었습니다.');
        } catch (error) {
            logger.error('Reload failed:', error);
            await interaction.editReply('❌ 리로드 중 오류가 발생했습니다.');
        }
    },
};

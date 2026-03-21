import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { buildContainerMessage } from '../commandShared/componentsV2.js';
import {
    canManagePermissions,
    isManagedSlashCommand,
    managedCommandChoices,
} from '../commandShared/slashPermission.js';
import {
    authorizeGuildId,
    fetchAlertSubscriptions,
    grantCommandPermission,
    listCommandPermissionsByCommand,
    listCommandPermissionsByUser,
    revokeCommandPermission,
    unauthorizeGuildId,
} from '../db/database.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { ChatInputCommandInteraction } from 'discord.js';

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('perm')
        .setDescription(defaultText('command.permDescription'))
        .addSubcommand((subcommand) =>
            subcommand.setName('panel').setDescription(defaultText('command.permDescription')),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('guild-authorize')
                .setDescription(defaultText('command.permGuildAuthorizeDescription'))
                .addStringOption((option) =>
                    option
                        .setName('guild_id')
                        .setDescription(defaultText('command.permGuildId'))
                        .setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('guild-unauthorize')
                .setDescription(defaultText('command.permGuildUnauthorizeDescription'))
                .addStringOption((option) =>
                    option
                        .setName('guild_id')
                        .setDescription(defaultText('command.permGuildId'))
                        .setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('grant')
                .setDescription(defaultText('command.permGrantDescription'))
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription(defaultText('command.permUser'))
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName('command')
                        .setDescription(defaultText('command.permCommand'))
                        .setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('revoke')
                .setDescription(defaultText('command.permRevokeDescription'))
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription(defaultText('command.permUser'))
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName('command')
                        .setDescription(defaultText('command.permCommand'))
                        .setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('list-user')
                .setDescription(defaultText('command.permListUserDescription'))
                .addUserOption((option) =>
                    option
                        .setName('user')
                        .setDescription(defaultText('command.permUser'))
                        .setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('list-command')
                .setDescription(defaultText('command.permListCommandDescription'))
                .addStringOption((option) =>
                    option
                        .setName('command')
                        .setDescription(defaultText('command.permCommand'))
                        .setRequired(true),
                ),
        )
        .setContexts(InteractionContextType.Guild),
    permission: {
        public: false,
        listable: false,
    },
    async execute(interaction: ChatInputCommandInteraction) {
        const locale = getInteractionLocale(interaction);
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuildStrict'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (!canManagePermissions(interaction)) {
            await interaction.reply({
                content: t(locale, 'common.devOnly'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const subcommand = interaction.options.getSubcommand(true);
        try {
            switch (subcommand) {
                case 'panel': {
                    const managedCommands = managedCommandChoices().map((item) => item.value);
                    const alertRows = await fetchAlertSubscriptions();
                    const guildAlertCount = alertRows.filter(
                        (row) => row.guild_id === interaction.guildId,
                    ).length;

                    const sections = [
                        {
                            title: 'Permission Console',
                            body: [
                                `Guild: ${interaction.guild?.name ?? interaction.guildId} (${interaction.guildId})`,
                                `Managed commands: ${managedCommands.length > 0 ? managedCommands.join(', ') : t(locale, 'report.none')}`,
                                `Alert subscriptions: ${guildAlertCount}`,
                            ].join('\n'),
                        },
                        {
                            title: 'Quick Actions',
                            body: [
                                '`/perm guild-authorize guild_id:<id>`',
                                '`/perm guild-unauthorize guild_id:<id>`',
                                '`/perm grant user:<user> command:<name>`',
                                '`/perm revoke user:<user> command:<name>`',
                                '`/perm list-user user:<user>`',
                                '`/perm list-command command:<name>`',
                            ].join('\n'),
                        },
                    ];

                    await interaction.reply({
                        ...buildContainerMessage({
                            title: 'Permission Panel',
                            description:
                                'Use this ephemeral panel as the control surface for permission operations.',
                            sections,
                            accentColor: 0x5865f2,
                            footer: `Requester: ${interaction.user.tag}`,
                        }),
                        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
                    });
                    return;
                }
                case 'guild-authorize': {
                    const guildId = interaction.options.getString('guild_id', true).trim();
                    await authorizeGuildId(guildId);
                    await interaction.reply({
                        content: t(locale, 'command.authorizeSuccess', { guildId }),
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                case 'guild-unauthorize': {
                    const guildId = interaction.options.getString('guild_id', true).trim();
                    await unauthorizeGuildId(guildId);
                    await interaction.reply({
                        content: t(locale, 'command.unauthorizeSuccess', { guildId }),
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                case 'grant': {
                    const user = interaction.options.getUser('user', true);
                    const commandName = interaction.options.getString('command', true);
                    if (!isManagedSlashCommand(commandName)) {
                        await interaction.reply({
                            content: t(locale, 'command.permUnknownCommand', {
                                command: commandName,
                                available: managedCommandChoices()
                                    .map((item) => item.value)
                                    .join(', '),
                            }),
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    await grantCommandPermission(interaction.guildId, commandName, user.id);
                    await interaction.reply({
                        content: t(locale, 'command.permGrantSuccess', {
                            userId: user.id,
                            command: commandName,
                        }),
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                case 'revoke': {
                    const user = interaction.options.getUser('user', true);
                    const commandName = interaction.options.getString('command', true);
                    if (!isManagedSlashCommand(commandName)) {
                        await interaction.reply({
                            content: t(locale, 'command.permUnknownCommand', {
                                command: commandName,
                                available: managedCommandChoices()
                                    .map((item) => item.value)
                                    .join(', '),
                            }),
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    await revokeCommandPermission(interaction.guildId, commandName, user.id);
                    await interaction.reply({
                        content: t(locale, 'command.permRevokeSuccess', {
                            userId: user.id,
                            command: commandName,
                        }),
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                case 'list-user': {
                    const user = interaction.options.getUser('user', true);
                    const commands = await listCommandPermissionsByUser(
                        interaction.guildId,
                        user.id,
                    );
                    await interaction.reply({
                        content: t(locale, 'command.permListUserResult', {
                            userId: user.id,
                            commands:
                                commands.length > 0
                                    ? commands.join(', ')
                                    : t(locale, 'report.none'),
                        }),
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                case 'list-command': {
                    const commandName = interaction.options.getString('command', true);
                    if (!isManagedSlashCommand(commandName)) {
                        await interaction.reply({
                            content: t(locale, 'command.permUnknownCommand', {
                                command: commandName,
                                available: managedCommandChoices()
                                    .map((item) => item.value)
                                    .join(', '),
                            }),
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    const users = await listCommandPermissionsByCommand(
                        interaction.guildId,
                        commandName,
                    );
                    const renderedUsers =
                        users.length > 0
                            ? users.map((id) => `<@${id}>`).join(', ')
                            : t(locale, 'report.none');
                    await interaction.reply({
                        content: t(locale, 'command.permListCommandResult', {
                            command: commandName,
                            users: renderedUsers,
                        }),
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                default:
                    await interaction.reply({
                        content: t(locale, 'common.unknownCommand'),
                        flags: MessageFlags.Ephemeral,
                    });
            }
        } catch (error) {
            logger.error(`/perm command failed (${subcommand}) by ${interaction.user.tag}:`, error);
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: t(locale, 'common.commandError'),
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.reply({
                content: t(locale, 'common.commandError'),
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};

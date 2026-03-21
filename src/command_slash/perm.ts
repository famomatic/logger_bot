import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    type ChatInputCommandInteraction,
    type InteractionEditReplyOptions,
    type InteractionReplyOptions,
    type MessageComponentInteraction,
    type MessageActionRowComponentBuilder,
} from 'discord.js';

import { buildContainerMessage } from '../commandShared/componentsV2.js';
import {
    canManagePermissions,
    isManagedSlashCommand,
    managedCommandChoices,
} from '../commandShared/slashPermission.js';
import {
    authorizeGuildId,
    grantCommandPermission,
    isGuildAuthorized,
    listCommandPermissionsByCommand,
    listCommandPermissionsByUser,
    revokeCommandPermission,
    unauthorizeGuildId,
} from '../db/database.js';
import { defaultText, getInteractionLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

const PANEL_PREFIX = 'perm_panel';
const COMMAND_SELECT_ID = `${PANEL_PREFIX}_command`;
const USER_SELECT_ID = `${PANEL_PREFIX}_user`;
const ACTION_GRANT_ID = `${PANEL_PREFIX}_grant`;
const ACTION_REVOKE_ID = `${PANEL_PREFIX}_revoke`;
const ACTION_LIST_USER_ID = `${PANEL_PREFIX}_list_user`;
const ACTION_LIST_COMMAND_ID = `${PANEL_PREFIX}_list_command`;
const ACTION_AUTHORIZE_GUILD_ID = `${PANEL_PREFIX}_authorize_guild`;
const ACTION_UNAUTHORIZE_GUILD_ID = `${PANEL_PREFIX}_unauthorize_guild`;
const ACTION_REFRESH_ID = `${PANEL_PREFIX}_refresh`;

interface PermPanelState {
    selectedCommand: string | null;
    selectedUserId: string | null;
    lastAction: string | null;
}

function buildPermPanelPayload(params: {
    locale: string;
    guildName: string;
    guildId: string;
    managedCommands: string[];
    state: PermPanelState;
}): {
    components: unknown[];
    allowedMentions: { parse: [] };
} {
    const { locale, guildName, guildId, managedCommands, state } = params;
    const currentGuildAuthorized = isGuildAuthorized(guildId);
    const selectedCommand = state.selectedCommand ?? t(locale, 'report.none');
    const selectedUser = state.selectedUserId
        ? `<@${state.selectedUserId}>`
        : t(locale, 'report.none');
    const lastAction = state.lastAction ?? t(locale, 'report.none');

    const header = buildContainerMessage({
        title: 'Permission Panel',
        description: 'Use the controls below to manage command permissions in this guild.',
        sections: [
            {
                title: 'Scope',
                body: `Guild: ${guildName} (${guildId})\nAuthorized: ${currentGuildAuthorized ? 'yes' : 'no'}`,
            },
            {
                title: 'Selection',
                body: `Command: ${selectedCommand}\nUser: ${selectedUser}`,
            },
            {
                title: 'Last Action',
                body: lastAction,
            },
        ],
        accentColor: 0x5865f2,
    });

    const commandOptions = managedCommands.slice(0, 25).map((command) => ({
        label: command,
        value: command,
        default: state.selectedCommand === command,
    }));

    const commandSelect = new StringSelectMenuBuilder()
        .setCustomId(COMMAND_SELECT_ID)
        .setPlaceholder('Select command')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(commandOptions);
    const commandRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        commandSelect,
    );

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId(USER_SELECT_ID)
        .setPlaceholder('Select user')
        .setMinValues(1)
        .setMaxValues(1);
    const userRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        userSelect,
    );

    const hasCommand = state.selectedCommand !== null;
    const hasUser = state.selectedUserId !== null;

    const actionRow1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(ACTION_GRANT_ID)
            .setLabel('Grant')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!hasCommand || !hasUser),
        new ButtonBuilder()
            .setCustomId(ACTION_REVOKE_ID)
            .setLabel('Revoke')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!hasCommand || !hasUser),
        new ButtonBuilder()
            .setCustomId(ACTION_LIST_USER_ID)
            .setLabel('List User')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasUser),
        new ButtonBuilder()
            .setCustomId(ACTION_LIST_COMMAND_ID)
            .setLabel('List Command')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasCommand),
        new ButtonBuilder()
            .setCustomId(ACTION_REFRESH_ID)
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Primary),
    );

    const actionRow2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(ACTION_AUTHORIZE_GUILD_ID)
            .setLabel('Authorize Guild')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(ACTION_UNAUTHORIZE_GUILD_ID)
            .setLabel('Unauthorize Guild')
            .setStyle(ButtonStyle.Danger),
    );

    return {
        components: [header.components[0], commandRow, userRow, actionRow1, actionRow2],
        allowedMentions: { parse: [] },
    };
}

async function runPanelAction(params: {
    locale: string;
    guildId: string;
    state: PermPanelState;
    actionId: string;
    managedCommands: string[];
}): Promise<string> {
    const { locale, guildId, state, actionId, managedCommands } = params;
    const selectedUserId = state.selectedUserId;
    const selectedCommand = state.selectedCommand;

    if (actionId === ACTION_REFRESH_ID) {
        return t(locale, 'command.permPanelRefreshed');
    }

    if (actionId === ACTION_AUTHORIZE_GUILD_ID) {
        await authorizeGuildId(guildId);
        return t(locale, 'command.authorizeSuccess', { guildId });
    }

    if (actionId === ACTION_UNAUTHORIZE_GUILD_ID) {
        await unauthorizeGuildId(guildId);
        return t(locale, 'command.unauthorizeSuccess', { guildId });
    }

    if ((actionId === ACTION_GRANT_ID || actionId === ACTION_REVOKE_ID) && !selectedUserId) {
        return t(locale, 'command.permPanelSelectCommandAndUserFirst');
    }

    if ((actionId === ACTION_GRANT_ID || actionId === ACTION_REVOKE_ID) && !selectedCommand) {
        return t(locale, 'command.permPanelSelectCommandAndUserFirst');
    }

    if (actionId === ACTION_LIST_USER_ID && !selectedUserId) {
        return t(locale, 'command.permPanelSelectUserFirst');
    }

    if (actionId === ACTION_LIST_COMMAND_ID && !selectedCommand) {
        return t(locale, 'command.permPanelSelectCommandFirst');
    }

    if (selectedCommand && !isManagedSlashCommand(selectedCommand)) {
        return t(locale, 'command.permUnknownCommand', {
            command: selectedCommand,
            available: managedCommands.join(', '),
        });
    }

    if (actionId === ACTION_GRANT_ID) {
        await grantCommandPermission(guildId, selectedCommand!, selectedUserId!);
        return t(locale, 'command.permGrantSuccess', {
            userId: selectedUserId!,
            command: selectedCommand!,
        });
    }

    if (actionId === ACTION_REVOKE_ID) {
        await revokeCommandPermission(guildId, selectedCommand!, selectedUserId!);
        return t(locale, 'command.permRevokeSuccess', {
            userId: selectedUserId!,
            command: selectedCommand!,
        });
    }

    if (actionId === ACTION_LIST_USER_ID) {
        const commands = await listCommandPermissionsByUser(guildId, selectedUserId!);
        return t(locale, 'command.permListUserResult', {
            userId: selectedUserId!,
            commands: commands.length > 0 ? commands.join(', ') : t(locale, 'report.none'),
        });
    }

    if (actionId === ACTION_LIST_COMMAND_ID) {
        const users = await listCommandPermissionsByCommand(guildId, selectedCommand!);
        const renderedUsers =
            users.length > 0 ? users.map((id) => `<@${id}>`).join(', ') : t(locale, 'report.none');
        return t(locale, 'command.permListCommandResult', {
            command: selectedCommand!,
            users: renderedUsers,
        });
    }

    logger.warn(`[perm-panel] Unknown action: ${actionId}`);
    return t(locale, 'common.unknownCommand');
}

/**
 * 슬래시 커맨드 모듈 계약(`export const command = { data, execute }`)입니다.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('perm')
        .setDescription(defaultText('command.permDescription'))
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

        const managedCommands = managedCommandChoices().map((item) => item.value);
        const state: PermPanelState = {
            selectedCommand: null,
            selectedUserId: null,
            lastAction: null,
        };

        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({
                content: t(locale, 'common.onlyInGuildStrict'),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            const initialPayload = buildPermPanelPayload({
                locale,
                guildName: interaction.guild?.name ?? guildId,
                guildId,
                managedCommands,
                state,
            });
            await interaction.reply({
                ...(initialPayload as InteractionReplyOptions),
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            });

            const message = await interaction.fetchReply();
            const collector = message.createMessageComponentCollector({
                filter: (i) =>
                    i.customId.startsWith(PANEL_PREFIX) && i.user.id === interaction.user.id,
                time: 15 * 60 * 1000,
            });

            collector.on('collect', (componentInteraction: MessageComponentInteraction) => {
                (async () => {
                    await componentInteraction.deferUpdate();

                    if (
                        componentInteraction.isStringSelectMenu() &&
                        componentInteraction.customId === COMMAND_SELECT_ID
                    ) {
                        state.selectedCommand = componentInteraction.values[0];
                        state.lastAction = `Selected command: ${state.selectedCommand}`;
                    } else if (
                        componentInteraction.isUserSelectMenu() &&
                        componentInteraction.customId === USER_SELECT_ID
                    ) {
                        state.selectedUserId = componentInteraction.values[0];
                        state.lastAction = `Selected user: <@${state.selectedUserId}>`;
                    } else if (componentInteraction.isButton()) {
                        state.lastAction = await runPanelAction({
                            locale,
                            guildId,
                            state,
                            actionId: componentInteraction.customId,
                            managedCommands,
                        });
                    }

                    const editPayload = buildPermPanelPayload({
                        locale,
                        guildName: interaction.guild?.name ?? guildId,
                        guildId,
                        managedCommands,
                        state,
                    });
                    await componentInteraction.editReply({
                        ...(editPayload as InteractionEditReplyOptions),
                        flags: MessageFlags.IsComponentsV2,
                    });
                })().catch((error) => {
                    logger.error(
                        `[perm-panel] interaction handling failed for ${interaction.user.tag}:`,
                        error,
                    );
                });
            });
        } catch (error) {
            logger.error(`/perm command failed by ${interaction.user.tag}:`, error);
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

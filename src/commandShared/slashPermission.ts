import { MessageFlags } from 'discord.js';

import { config } from '../config/config.js';
import { hasCommandPermission } from '../db/database.js';
import { getInteractionLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { SlashCommand } from '../types/commands.js';
import type { ChatInputCommandInteraction } from 'discord.js';

interface SlashPermissionCatalogEntry {
    name: string;
    public: boolean;
    listable: boolean;
}

const slashPermissionCatalog = new Map<string, SlashPermissionCatalogEntry>();

export function setSlashPermissionCatalog(commands: SlashCommand[]): void {
    slashPermissionCatalog.clear();

    for (const command of commands) {
        const name = command.data.name;
        const isPublic = command.permission?.public === true;
        const isListable = command.permission?.listable ?? (!isPublic && name !== 'perm');
        slashPermissionCatalog.set(name, {
            name,
            public: isPublic,
            listable: isListable,
        });
    }
}

export function isManagedSlashCommand(commandName: string): boolean {
    const item = slashPermissionCatalog.get(commandName);
    if (!item) return false;
    return !item.public && item.listable;
}

export function isSuperAdmin(userId: string): boolean {
    return config.superAdminIds.includes(userId);
}

export function canManagePermissions(interaction: ChatInputCommandInteraction): boolean {
    return isSuperAdmin(interaction.user.id);
}

export async function ensureSlashCommandPermission(
    interaction: ChatInputCommandInteraction,
): Promise<boolean> {
    const locale = getInteractionLocale(interaction);
    const commandName = interaction.commandName;

    if (!interaction.inGuild()) {
        await interaction.reply({
            content: t(locale, 'common.onlyInGuildStrict'),
            flags: MessageFlags.Ephemeral,
        });
        return false;
    }

    const commandMeta = slashPermissionCatalog.get(commandName);
    if (commandMeta?.public) {
        return true;
    }

    if (commandName === 'perm') {
        if (canManagePermissions(interaction)) {
            return true;
        }
        await interaction.reply({
            content: t(locale, 'common.devOnly'),
            flags: MessageFlags.Ephemeral,
        });
        return false;
    }

    if (!isManagedSlashCommand(commandName)) {
        return true;
    }

    if (isSuperAdmin(interaction.user.id)) {
        return true;
    }

    const allowed = await hasCommandPermission(
        interaction.guildId,
        commandName,
        interaction.user.id,
    );
    if (!allowed) {
        await interaction.reply({
            content: t(locale, 'common.commandNotAllowed'),
            flags: MessageFlags.Ephemeral,
        });
        return false;
    }

    return true;
}

export function managedCommandChoices(): { name: string; value: string }[] {
    return Array.from(slashPermissionCatalog.values())
        .filter((item) => !item.public && item.listable)
        .map((item) => ({ name: item.name, value: item.name }));
}

export function logPermissionCheckFailure(
    interaction: ChatInputCommandInteraction,
    error: unknown,
): void {
    logger.error(
        `Permission check failed command=${interaction.commandName} guild=${interaction.guildId ?? 'dm'} user=${interaction.user.id}`,
        error,
    );
}

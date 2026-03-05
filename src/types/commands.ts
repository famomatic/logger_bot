import type {
    Client,
    Collection,
    CommandInteraction,
    Message,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
} from 'discord.js';

export interface LegacyCommand {
    name: string;
    execute: (message: Message) => Promise<void>;
}

export interface SlashCommandPermissionMeta {
    public?: boolean;
    listable?: boolean;
}

export interface SlashCommand {
    data:
        | SlashCommandOptionsOnlyBuilder
        | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
    permission?: SlashCommandPermissionMeta;
    execute: (interaction: CommandInteraction, client: Client) => Promise<void>;
}

export interface ClientWithLegacyCommands extends Client {
    legacyCommands?: Collection<string, LegacyCommand>;
}

export interface AttachmentData {
    id: string;
    storagePath: string | null;
    downloadError: string | null;
    filename: string;
    size: number;
    contentType: string | null;
    discordUrl: string;
}

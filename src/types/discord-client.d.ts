import type { Collection } from 'discord.js';
import type { LegacyCommand, SlashCommand } from './commands.js';

declare module 'discord.js' {
    interface Client {
        commands?: Collection<string, SlashCommand>;
        legacyCommands?: Collection<string, LegacyCommand>;
    }
}

export {};

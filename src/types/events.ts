export interface EventHandler {
    name: string;
    once?: boolean;
    execute: (...args: unknown[]) => Promise<void>;
}

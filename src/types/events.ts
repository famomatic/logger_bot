export interface EventHandler {
    name: string;
    once?: boolean;
    execute: (...args: unknown[]) => Promise<void>;
}

export interface RegisteredEventListener {
    eventName: string;
    listener: (...args: unknown[]) => void;
}

declare module 'node-pty' {
    export interface IPty {
        onData(listener: (data: string) => void): void;
        onExit(
            listener: (event: { exitCode: number | null; signal?: number | string | null }) => void,
        ): void;
        write(data: string): void;
        kill(signal?: string): void;
    }

    export interface IPtyForkOptions {
        name?: string;
        cols?: number;
        rows?: number;
        cwd?: string;
        env?: NodeJS.ProcessEnv;
    }

    export function spawn(file: string, args?: readonly string[], options?: IPtyForkOptions): IPty;
}

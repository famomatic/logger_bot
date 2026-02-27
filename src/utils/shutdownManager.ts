type ShutdownHandler = (context: { reason: string; error?: unknown }) => Promise<void> | void;

let handler: ShutdownHandler | null = null;
let shuttingDown = false;

export function registerShutdownHandler(nextHandler: ShutdownHandler): void {
    handler = nextHandler;
}

export async function requestShutdown(
    reason: string,
    options: { error?: unknown; exitCode?: number } = {},
): Promise<void> {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    const exitCode = options.exitCode ?? 1;

    try {
        if (handler) {
            await handler({ reason, error: options.error });
        }
    } catch (cleanupError) {
        console.error('[shutdown] cleanup failed:', cleanupError);
    } finally {
        process.exit(exitCode);
    }
}

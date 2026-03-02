type ShutdownHandler = (context: { reason: string; error?: unknown }) => Promise<void> | void;

let handler: ShutdownHandler | null = null;
let shuttingDown = false;

/**
 * 기존 종료 핸들러 체인 뒤에 새 종료 핸들러를 연결합니다.
 */
export function registerShutdownHandler(nextHandler: ShutdownHandler): void {
    handler = nextHandler;
}

/**
 * 종료 사유를 기록하고 등록된 종료 핸들러를 통해 안전 종료를 요청합니다.
 */
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

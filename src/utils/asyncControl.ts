/**
 * 제한 동시성으로 비동기 작업 배열을 실행하고 입력 순서를 보존합니다.
 */
export async function mapWithConcurrency<TInput, TOutput>(
    items: readonly TInput[],
    concurrency: number,
    mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
    if (items.length === 0) {
        return [];
    }

    const limit = Math.max(1, concurrency);
    const results = new Array<TOutput>(items.length);
    let nextIndex = 0;

    const worker = async () => {
        for (;;) {
            const current = nextIndex;
            nextIndex++;
            if (current >= items.length) {
                return;
            }
            results[current] = await mapper(items[current], current);
        }
    };

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

/**
 * 지정한 시간 안에 완료되지 않으면 타임아웃 에러로 실패시킵니다.
 */
export async function withTimeout<T>(
    task: Promise<T>,
    timeoutMs: number,
    errorMessage: string,
): Promise<T> {
    if (timeoutMs <= 0) {
        return await task;
    }

    let timeoutHandle!: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(errorMessage));
        }, timeoutMs);
    });

    try {
        return await Promise.race([task, timeout]);
    } finally {
        clearTimeout(timeoutHandle);
    }
}

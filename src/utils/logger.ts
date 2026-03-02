import chalk from 'chalk';
import { config } from '../config/config.js';
import { inspect } from 'node:util';

// Sentry 및 관련 모듈 import (ESM 방식)
import * as Sentry from '@sentry/node';
// Http 통합 기능은 @sentry/node에 포함되어 있을 수 있음
// import { Http } from '@sentry/node'; // 필요시 명시적 import
import { nodeProfilingIntegration } from '@sentry/profiling-node';
// 기본 통합 기능 목록을 가져오는 함수 import
import { getDefaultIntegrations } from '@sentry/node';
import { requestShutdown } from './shutdownManager.js';

// Sentry 초기화 (DSN이 설정된 경우에만)
// --- Sentry 재활성화 ---
if (config.sentryDsn) {
    try {
        const integrations = getDefaultIntegrations({}).filter(
            (integration: { name: string }) => integration.name !== 'Pg',
        );
        integrations.push(nodeProfilingIntegration());

        Sentry.init({
            dsn: config.sentryDsn,
            integrations: integrations,
            tracesSampleRate: 1.0,
            profilesSampleRate: 1.0,
            environment: config.nodeEnv,
        });
        console.log(chalk.green('Sentry initialized (Pg integration disabled).'));
    } catch (error) {
        console.error(chalk.red('Failed to initialize Sentry:'), error);
        console.log(chalk.yellow('Sentry integration disabled due to initialization error.'));
        config.sentryDsn = undefined;
    }
} else {
    console.log(chalk.yellow('Sentry DSN not found, Sentry integration disabled.'));
}
// --- -------------- ---
// console.log(chalk.yellow('Sentry integration is temporarily disabled for debugging purposes.'));

// 로그 레벨별 색상 정의
const levelColors = {
    info: chalk.blueBright,
    warn: chalk.yellowBright,
    error: chalk.redBright,
    debug: chalk.gray,
    success: chalk.greenBright,
};

// 타임스탬프 포맷 함수
const getTimestamp = () => new Date().toISOString();

/**
 * Error/객체/원시값을 로그 출력 가능한 형태로 정규화합니다.
 */
const formatLogArg = (arg: unknown): unknown => {
    if (arg instanceof Error) {
        return arg.stack ?? `${arg.name}: ${arg.message}`;
    }

    if (typeof arg === 'object' && arg !== null) {
        return inspect(arg, { depth: 5, colors: false, compact: false });
    }

    return arg;
};

// 기본 로거 함수
const log = (level: keyof typeof levelColors, ...args: unknown[]) => {
    const color = levelColors[level] ?? chalk.white;
    const timestamp = chalk.cyan(`[${getTimestamp()}]`);
    const levelTag = color(`[${level.toUpperCase()}]`);

    const formattedArgs = args.map(formatLogArg);

    console.log(timestamp, levelTag, ...formattedArgs);
};

/**
 * 프로젝트 전역 로거입니다. 콘솔 출력과 Sentry 예외 캡처를 함께 처리합니다.
 */
export const logger = {
    info: (...args: unknown[]) => log('info', ...args),
    warn: (...args: unknown[]) => log('warn', ...args),
    error: (message: string, error?: unknown, ...args: unknown[]) => {
        log('error', message, error ?? '', ...args);
        // Sentry 재활성화
        if (config.sentryDsn && Sentry && typeof Sentry.captureException === 'function') {
            const errorToCapture = error instanceof Error ? error : new Error(String(message));
            Sentry.captureException(errorToCapture, {
                extra: { details: args },
            });
        }
    },
    debug: (...args: unknown[]) => {
        if (config.nodeEnv === 'development') {
            log('debug', ...args);
        }
    },
    success: (...args: unknown[]) => log('success', ...args),
};

// 예기치 않은 에러 및 처리되지 않은 거부 처리
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    // Sentry 재활성화
    if (config.sentryDsn && Sentry && typeof Sentry.captureException === 'function') {
        Sentry.captureException(err, (scope: Sentry.Scope) => {
            scope.setLevel('fatal');
            return scope;
        });
        Promise.resolve(Sentry.close(2000))
            .catch((closeErr) =>
                console.error(chalk.red('Sentry close error on uncaughtException:'), closeErr),
            )
            .finally(() => {
                void requestShutdown('uncaughtException', { error: err, exitCode: 1 });
            });
    } else {
        void requestShutdown('uncaughtException', { error: err, exitCode: 1 });
    }
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Sentry 재활성화
    if (config.sentryDsn && Sentry && typeof Sentry.captureException === 'function') {
        Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
            extra: { promiseDetails: promise },
        });
        Promise.resolve(Sentry.close(2000))
            .catch((closeErr) =>
                console.error(chalk.red('Sentry close error on unhandledRejection:'), closeErr),
            )
            .finally(() => {
                void requestShutdown('unhandledRejection', { error: reason, exitCode: 1 });
            });
    } else {
        void requestShutdown('unhandledRejection', { error: reason, exitCode: 1 });
    }
});

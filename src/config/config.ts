import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

/**
 * `10s`, `500ms`, `2m` 같은 duration 문자열을 밀리초 값으로 변환합니다.
 */
function parseDurationToMs(input?: string | null): number | undefined {
    if (!input) {
        return undefined;
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return undefined;
    }

    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(trimmed);
    if (!match) {
        return undefined;
    }

    const value = Number(match[1]);
    if (Number.isNaN(value)) {
        return undefined;
    }

    const unit = (match[2] ?? 's').toLowerCase();
    const multiplier = unit === 'ms' ? 1 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 1_000;

    return Math.round(value * multiplier);
}

/**
 * 정수 환경변수를 파싱하고 실패 시 기본값을 반환합니다.
 */
function parseInteger(input: string | undefined, fallback: number): number {
    if (!input) return fallback;
    const parsed = parseInt(input, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 불리언 환경변수를 파싱하고 값이 없으면 기본값을 반환합니다.
 */
function parseBoolean(input: string | undefined, fallback: boolean): boolean {
    if (!input) {
        return fallback;
    }
    const normalized = input.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }
    return fallback;
}

/**
 * 환경변수에서 런타임 설정을 구성하고 필수값 누락 시 예외를 던집니다.
 */
function loadConfig() {
    const requiredEnvVars = [
        'DISCORD_BOT_TOKEN',
        'DISCORD_CLIENT_ID',
        'BOT_DB_NAME',
        'BOT_DB_USER',
        'BOT_DB_PASSWORD',
    ];

    const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

    if (missingEnvVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    }

    // WebDAV 설정 처리
    const webdavHost = process.env.WEBDAV_HOST;
    const webdavPort = process.env.WEBDAV_PORT; // 포트는 문자열일 수 있음
    const webdavHttps = process.env.WEBDAV_HTTPS?.toLowerCase() !== 'false'; // 기본값 true
    let webdavUrl = null;
    if (webdavHost) {
        const protocol = webdavHttps ? 'https' : 'http';
        webdavUrl = `${protocol}://${webdavHost}${webdavPort ? ':' + webdavPort : ''}`;
    }

    const superAdminIds = (process.env.SUPER_ADMIN_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    const nodeEnv = process.env.NODE_ENV ?? 'development';
    const dbSsl = parseBoolean(process.env.PG_SSL, nodeEnv === 'production');
    const dbSslRejectUnauthorized = parseBoolean(process.env.PG_SSL_REJECT_UNAUTHORIZED, true);

    return {
        discordBotToken: process.env.DISCORD_BOT_TOKEN!,
        clientId: process.env.DISCORD_CLIENT_ID!,
        dbName: process.env.BOT_DB_NAME!,
        dbUser: process.env.BOT_DB_USER!,
        dbPassword: process.env.BOT_DB_PASSWORD!,
        dbHost: process.env.PG_HOST ?? 'localhost',
        dbPort: parseInt(process.env.PG_PORT ?? '5432', 10),
        dbSsl,
        dbSslRejectUnauthorized,
        redis: {
            enabled: process.env.REDIS_ENABLED?.toLowerCase() === 'true',
            host: process.env.REDIS_HOST ?? '127.0.0.1',
            port: parseInteger(process.env.REDIS_PORT, 6379),
            db: parseInteger(process.env.REDIS_DB, 0),
            password: process.env.REDIS_PASSWORD,
            queueName: process.env.REDIS_QUEUE_NAME ?? 'logger:events',
            batchSize: parseInteger(process.env.LOG_QUEUE_BATCH_SIZE, 100),
            flushIntervalMs: parseInteger(process.env.LOG_QUEUE_FLUSH_INTERVAL_MS, 1000),
            maxRetries: parseInteger(process.env.LOG_QUEUE_MAX_RETRIES, 3),
        },
        messageRecovery: {
            enabled: process.env.MESSAGE_RECOVERY_ENABLED?.toLowerCase() !== 'false',
            maxPagesPerChannel: Math.max(
                1,
                parseInteger(process.env.MESSAGE_RECOVERY_MAX_PAGES_PER_CHANNEL, 20),
            ),
        },
        sentryDsn: process.env.SENTRY_DSN,
        nodeEnv,
        superAdminIds,

        // 통합 스토리지 설정
        storage: {
            type: (process.env.STORAGE_TYPE ?? (webdavHost ? 'webdav' : 'local')).toLowerCase() as
                | 'webdav'
                | 's3'
                | 'smb'
                | 'local',
            local: {
                path: process.env.LOCAL_STORAGE_PATH ?? './storage',
            },
            webdav: {
                enabled: !!webdavHost, // 호스트가 설정되어야 활성화
                url: webdavUrl, // 조합된 URL 저장
                host: webdavHost,
                port: webdavPort,
                https: webdavHttps,
                username: process.env.WEBDAV_USERNAME,
                password: process.env.WEBDAV_PASSWORD,
                basePath: process.env.WEBDAV_BASE_PATH ?? '/discord_logs',
            },
            s3: {
                region: process.env.S3_REGION ?? '',
                bucket: process.env.S3_BUCKET ?? '',
                accessKeyId: process.env.S3_ACCESS_KEY ?? '',
                secretAccessKey: process.env.S3_SECRET_KEY ?? '',
                endpoint: process.env.S3_ENDPOINT, // Optional
            },
            smb: {
                url: process.env.SMB_SHARE_URL ?? '', // \\host\share
                domain: process.env.SMB_DOMAIN ?? '',
                username: process.env.SMB_USERNAME ?? '',
                password: process.env.SMB_PASSWORD ?? '',
            },
        },
        sudoPassword: process.env.SUDO_PASSWORD,
        sudoPasswordCommand: process.env.SUDO_PASSWORD_COMMAND,
        execCommandTimeoutMs: parseDurationToMs(
            process.env.EXEC_COMMAND_TIMEOUT ?? process.env.EXEC_COMMAND_TIMEOUT_MS,
        ),
    };
}

// 설정 객체 내보내기
export let config = loadConfig();

/**
 * 환경변수를 다시 읽어 설정 객체를 런타임에 갱신합니다.
 */
export function reloadConfig(): void {
    config = loadConfig();
    console.log(chalk.green('Configuration reloaded.'));
    logStorageConfig();
}

/**
 * 현재 스토리지 백엔드 설정 요약을 콘솔에 출력합니다.
 */
function logStorageConfig(): void {
    const storageType = config.storage.type;
    console.log(chalk.cyan(`Storage type: ${storageType}`));

    if (storageType === 'webdav') {
        if (config.storage.webdav.enabled && config.storage.webdav.url) {
            console.log(
                chalk.green(
                    `WebDAV storage enabled: ${config.storage.webdav.url}${config.storage.webdav.basePath}`,
                ),
            );
            return;
        }
        console.log(chalk.yellow('WebDAV selected but not configured (WEBDAV_HOST not set).'));
        return;
    }

    if (storageType === 's3') {
        if (config.storage.s3.bucket && config.storage.s3.region) {
            console.log(chalk.green(`S3 storage enabled: s3://${config.storage.s3.bucket}`));
            return;
        }
        console.log(chalk.yellow('S3 selected but not fully configured (S3_BUCKET / S3_REGION).'));
        return;
    }

    if (storageType === 'smb') {
        if (config.storage.smb.url) {
            console.log(chalk.green(`SMB storage enabled: ${config.storage.smb.url}`));
            return;
        }
        console.log(chalk.yellow('SMB selected but not configured (SMB_SHARE_URL not set).'));
        return;
    }

    console.log(chalk.green(`Local storage enabled: ${config.storage.local.path}`));
}

console.log(chalk.green('Configuration loaded.'));
logStorageConfig();

/**
 * 현재 활성 런타임 설정 객체의 기본 export 입니다.
 */
export default config;

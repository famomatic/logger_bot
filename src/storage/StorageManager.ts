import { LocalStorageProvider } from './providers/LocalProvider.js';
import { S3StorageProvider } from './providers/S3Provider.js';
import { SMBStorageProvider } from './providers/SMBProvider.js';
import { WebDAVProvider } from './providers/WebDAVProvider.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

import type { StorageProvider } from '../types/storage.js';

/**
 * 설정된 스토리지 백엔드를 초기화하고 업/다운로드를 위임하는 파사드입니다.
 */
export class StorageManager {
    private provider: StorageProvider;

    constructor() {
        const type = config.storage.type;
        logger.info(`Initializing storage provider: ${type}`);

        switch (type) {
            case 's3':
                this.provider = new S3StorageProvider(
                    config.storage.s3.region,
                    config.storage.s3.bucket,
                    config.storage.s3.accessKeyId,
                    config.storage.s3.secretAccessKey,
                    config.storage.s3.endpoint,
                );
                break;
            case 'smb':
                this.provider = new SMBStorageProvider(
                    config.storage.smb.url,
                    config.storage.smb.domain,
                    config.storage.smb.username,
                    config.storage.smb.password,
                );
                break;
            case 'webdav':
                if (!config.storage.webdav.url) {
                    throw new Error('WebDAV is configured but URL is missing.');
                }
                this.provider = new WebDAVProvider(
                    config.storage.webdav.url,
                    config.storage.webdav.username,
                    config.storage.webdav.password,
                    config.storage.webdav.basePath,
                );
                break;
            case 'local':
            default:
                this.provider = new LocalStorageProvider(config.storage.local.path);
                break;
        }
    }

    async upload(filePath: string, content: Buffer): Promise<string> {
        try {
            const storedPath = await this.provider.upload(filePath, content);
            logger.debug(`File uploaded successfully to ${storedPath}`);
            return storedPath;
        } catch (error) {
            logger.error(`Failed to upload file to ${filePath}:`, error);
            throw error;
        }
    }

    async download(filePath: string): Promise<Buffer> {
        try {
            const content = await this.provider.download(filePath);
            logger.debug(`File downloaded successfully from ${filePath}`);
            return content;
        } catch (error) {
            logger.error(`Failed to download file from ${filePath}:`, error);
            throw error;
        }
    }
}

/**
 * 애플리케이션 전역에서 재사용하는 스토리지 매니저 싱글턴입니다.
 */
export const storageManager = new StorageManager();

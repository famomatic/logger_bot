import { createClient, WebDAVClient, WebDAVClientOptions } from 'webdav';
import type { StorageProvider } from '../../types/storage.js';
import { setDefaultResultOrder } from 'node:dns';
import { logger } from '../../utils/logger.js';

/**
 * WebDAV 서버 기반 첨부파일 스토리지 구현입니다.
 */
export class WebDAVProvider implements StorageProvider {
    private client: WebDAVClient;
    private basePath: string;

    constructor(url: string, username?: string, password?: string, basePath = '/') {
        // DNS resolution fix for Linux
        if (process.platform === 'linux' && typeof setDefaultResultOrder === 'function') {
            try {
                setDefaultResultOrder('ipv4first');
            } catch {
                // Ignore error
            }
        }

        const options: WebDAVClientOptions = {};
        if (username && password) {
            // Manually generate the Authorization header so UTF-8 usernames/passwords are supported.
            const basicAuthHeader = Buffer.from(`${username}:${password}`, 'utf8').toString(
                'base64',
            );
            options.headers = {
                Authorization: `Basic ${basicAuthHeader}`,
            };
        }

        this.client = createClient(url, options);
        this.basePath = basePath;
    }

    async upload(filePath: string, content: Buffer): Promise<string> {
        const fullPath = this.normalizePath(filePath);
        const dir = fullPath.split('/').slice(0, -1).join('/');
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Ensure directory exists - webdav might not auto-create
                if (dir && dir !== '/') {
                    if (!(await this.client.exists(dir))) {
                        // Add recursive: true just in case, though usually handled by parent checks or we should do it iteratively if needed
                        await this.client.createDirectory(dir, { recursive: true });
                    }
                }

                await this.client.putFileContents(fullPath, content, { overwrite: true });
                return fullPath;
            } catch (error) {
                // 403 Forbidden: Permission Denied - do not retry
                const err = error as { response?: { status: number }; message?: string };
                if (err.response?.status === 403 || err.message?.includes('403')) {
                    logger.error(`WebDAV upload failed with 403 Forbidden for ${fullPath}.`);
                    throw error;
                }

                if (attempt < maxRetries) {
                    const delay = 1000 * attempt;
                    logger.warn(
                        `Failed to upload file to WebDAV path ${fullPath}. Retrying after ${delay}ms... (${attempt}/${maxRetries})`,
                        error,
                    );
                    await new Promise((resolve) => setTimeout(resolve, delay));
                } else {
                    logger.error(
                        `Failed to upload file to WebDAV path ${fullPath} after ${maxRetries} attempts:`,
                        error,
                    );
                    throw error;
                }
            }
        }
        throw new Error(`Failed to upload file to WebDAV after ${maxRetries} attempts.`);
    }

    async download(filePath: string): Promise<Buffer> {
        const fullPath = this.resolveDownloadPath(filePath);
        try {
            const result = await this.client.getFileContents(fullPath, { format: 'binary' });
            if (Buffer.isBuffer(result)) {
                return result;
            } else if (result instanceof ArrayBuffer) {
                return Buffer.from(result);
            }
            throw new Error('Downloaded content is not a buffer');
        } catch (error) {
            const err = error as { response?: { status: number } };
            if (err.response?.status === 404) {
                throw new Error(`File not found: ${fullPath}`);
            }
            throw error;
        }
    }

    private resolveDownloadPath(filePath: string): string {
        const normalizedBase = this.basePath.replace(/\/+$/, '');
        const normalizedInput = filePath.startsWith('/') ? filePath : `/${filePath}`;

        // Keep backward compatibility for rows that already store an absolute WebDAV path.
        if (
            normalizedInput === normalizedBase ||
            normalizedInput.startsWith(`${normalizedBase}/`)
        ) {
            return normalizedInput;
        }

        return this.normalizePath(filePath);
    }

    private normalizePath(filePath: string): string {
        // Join with base path and ensure single leading slash
        // If filePath includes the basePath already, we should handle that?
        // The previous client logic was: `${config.storage.webdav.basePath}/${relativePath.replace(/^\/+/, '')}`
        // StorageManager passes the relative path usually.

        const normalizedBase = this.basePath.replace(/\/+$/, '');
        const normalizedFile = filePath.replace(/^\/+/, '');

        return `${normalizedBase}/${normalizedFile}`;
    }
}

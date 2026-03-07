import path from 'node:path';

import SMB2 from '@marsaud/smb2';

import type { StorageProvider } from '../../types/storage.js';

/**
 * SMB 네트워크 공유 기반 첨부파일 스토리지 구현입니다.
 */
export class SMBStorageProvider implements StorageProvider {
    private client: SMB2;

    constructor(shareUrl: string, domain: string, username: string, password: string) {
        this.client = new SMB2({
            share: normalizeSharePath(shareUrl),
            domain,
            username,
            password,
            autoCloseTimeout: 0,
        });
    }

    async upload(filePath: string, content: Buffer): Promise<string> {
        const smbPath = filePath.replace(/\//g, '\\');
        const dir = path.dirname(smbPath);

        if (dir !== '.' && dir !== '\\' && !(await this.client.exists(dir))) {
            await this.client.mkdir(dir, { recursive: true });
        }

        await this.client.writeFile(smbPath, content);
        return smbPath;
    }

    async download(filePath: string): Promise<Buffer> {
        const smbPath = filePath.replace(/\//g, '\\');
        return this.client.readFile(smbPath);
    }
}

/**
 * SMB 공유 경로를 `\\\\host\\share\\...` 형태로 정규화합니다.
 */
function normalizeSharePath(shareUrl: string): string {
    const match = /^\\\\([^\\]+)\\(.+)$/.exec(shareUrl);
    if (!match) {
        return shareUrl;
    }

    return `\\\\${match[1]}\\${match[2]}`;
}

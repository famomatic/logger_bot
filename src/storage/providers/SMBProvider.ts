import SMB2 from '@marsaud/smb2';
import path from 'path';
import { StorageProvider } from '../StorageProvider.js';

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

function normalizeSharePath(shareUrl: string): string {
    const match = /^\\\\([^\\]+)\\(.+)$/.exec(shareUrl);
    if (!match) {
        return shareUrl;
    }

    return `\\\\${match[1]}\\${match[2]}`;
}

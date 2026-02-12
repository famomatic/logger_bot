import SMB2Default from '@marsaud/smb2';
import { StorageProvider } from '../StorageProvider.js';
import path from 'path';

interface SMB2Client {
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, content: Buffer): Promise<void>;
    readFile(path: string): Promise<Buffer>;
    close?(): void;
}

interface SMB2Options {
    share: string;
    domain: string;
    username: string;
    password: string;
    autoCloseTimeout?: number;
}

// Define a constructor signature
type SMB2Constructor = new (options: SMB2Options) => SMB2Client;

// Cast the imported default to the constructor type
const SMB2 = SMB2Default as unknown as SMB2Constructor;

export class SMBStorageProvider implements StorageProvider {
    private client: SMB2Client;

    constructor(shareUrl: string, domain: string, username: string, password: string) {
        // Parse shareUrl to extract host and share
        const match = /^\\\\([^\\]+)\\(.+)$/.exec(shareUrl);
        // Removed unused 'host' variable
        let share = '';

        if (match) {
            // host = match[1]; // Unused
            share = match[2];
        }

        this.client = new SMB2({
            share: share,
            domain: domain,
            username: username,
            password: password,
            autoCloseTimeout: 0,
        });

        if (!share.startsWith('\\\\')) {
            // Reconstruct full share path if it was split or original was just host?
            // If share is empty, we use shareUrl as share (assuming it's the full path)
            // But the logic above: if match, share is extracted. If not match, share is empty.
            // If share is empty, we use shareUrl.

            const finalShare = share || shareUrl;

            this.client = new SMB2({
                share: finalShare,
                domain,
                username,
                password,
                autoCloseTimeout: 0,
            });
        }
    }

    async upload(filePath: string, content: Buffer): Promise<string> {
        // SMB paths use backslashes
        const smbPath = filePath.replace(/\//g, '\\');
        const dir = path.dirname(smbPath);

        // Check if directory exists, create if not
        if (dir !== '.' && dir !== '\\') {
            if (!(await this.client.exists(dir))) {
                await this.client.mkdir(dir, { recursive: true });
            }
        }

        await this.client.writeFile(smbPath, content);
        return smbPath;
    }

    async download(filePath: string): Promise<Buffer> {
        const smbPath = filePath.replace(/\//g, '\\');
        const content = await this.client.readFile(smbPath);
        return content;
    }
}

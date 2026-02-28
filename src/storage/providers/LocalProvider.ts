import fs from 'fs/promises';
import path from 'path';
import type { StorageProvider } from '../../types/storage.js';

export class LocalStorageProvider implements StorageProvider {
    private basePath: string;

    constructor(basePath: string) {
        this.basePath = basePath;
    }

    async upload(filePath: string, content: Buffer): Promise<string> {
        const fullPath = path.join(this.basePath, filePath);
        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fullPath, content);
        return fullPath;
    }

    async download(filePath: string): Promise<Buffer> {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.basePath, filePath);
        return await fs.readFile(fullPath);
    }
}

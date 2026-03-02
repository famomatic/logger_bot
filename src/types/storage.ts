export interface StorageProvider {
    upload(path: string, content: Buffer): Promise<string>;
    download(path: string): Promise<Buffer>;
}

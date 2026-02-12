export interface StorageProvider {
    /**
     * Upload a file to the storage provider.
     * @param path The path where the file should be saved (relative to the provider's root).
     * @param content The file content buffer.
     * @returns The full path or identifier of the stored file.
     */
    upload(path: string, content: Buffer): Promise<string>;

    /**
     * Download a file from the storage provider.
     * @param path The path of the file to download.
     * @returns The file content as a Buffer.
     */
    download(path: string): Promise<Buffer>;
}

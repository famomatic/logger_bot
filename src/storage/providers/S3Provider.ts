import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

import type { StorageProvider } from '../../types/storage.js';
import type { Readable } from 'node:stream';

/**
 * AWS S3(또는 호환 오브젝트 스토리지) 기반 첨부파일 스토리지 구현입니다.
 */
export class S3StorageProvider implements StorageProvider {
    private client: S3Client;
    private bucket: string;

    constructor(
        region: string,
        bucket: string,
        accessKeyId: string,
        secretAccessKey: string,
        endpoint?: string,
    ) {
        this.client = new S3Client({
            region,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
            endpoint,
            forcePathStyle: !!endpoint, // needed for some S3 compatible providers like MinIO
        });
        this.bucket = bucket;
    }

    async upload(filePath: string, content: Buffer): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: filePath, // S3 keys don't start with / usually, but we'll assume the caller handles this or we strip it
            Body: new Uint8Array(content.buffer, content.byteOffset, content.byteLength),
        });
        await this.client.send(command);
        return filePath;
    }

    async download(filePath: string): Promise<Buffer> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
        });
        const response = await this.client.send(command);

        if (!response.Body) {
            throw new Error(`File not found or empty: ${filePath}`);
        }

        // Convert stream to buffer
        const stream = response.Body as Readable;
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer));
        }
        return Buffer.concat(chunks);
    }
}

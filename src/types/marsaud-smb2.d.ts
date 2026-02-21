declare module '@marsaud/smb2' {
    export interface SMB2MkdirOptions {
        recursive?: boolean;
    }

    export interface SMB2Options {
        share: string;
        domain?: string;
        username?: string;
        password?: string;
        autoCloseTimeout?: number;
    }

    export default class SMB2 {
        constructor(options: SMB2Options);
        exists(path: string): Promise<boolean>;
        mkdir(path: string, options?: SMB2MkdirOptions): Promise<void>;
        writeFile(path: string, data: Buffer | string): Promise<void>;
        readFile(path: string): Promise<Buffer>;
    }
}

import type { AttachmentData } from './commands.js';

export type AttachmentLogData = Pick<AttachmentData, 'id' | 'filename'> &
    Partial<Pick<AttachmentData, 'storagePath' | 'discordUrl'>>;

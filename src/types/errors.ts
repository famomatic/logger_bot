export interface ErrorWithCode {
    code?: number | string;
    message?: string;
}

export interface PgError extends Error {
    code?: string;
    detail?: string;
}

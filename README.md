[한국어](./README.ko.md) | [English](./README.md)

# Discord Logger Bot

Production-focused Discord logging bot built with TypeScript + Discord.js v14.  
It captures high-volume guild events, stores them in PostgreSQL, and provides operational slash commands for search, export, alerts, reporting, and moderation workflows.

## Highlights

- Full-spectrum event logging: messages, edits/deletes, reactions, members, roles, channels, threads, voice, invites, scheduled events, stickers, and more.
- PostgreSQL-first architecture with guild-aware storage patterns and duplicate-safe ingestion.
- Queue-backed ingestion with optional Redis buffering for burst traffic.
- Startup message recovery to backfill missed `messageCreate` logs after downtime.
- Powerful slash command set:
- Log operations: `log-search`, `log-export`, `log-alert-*`
- Message operations: `message-send-*`, `message-delete-*`, `log-*-messages`
- Reporting: `report-guild`, `report-channel`, `report-user`
- Ops/admin: `status`, `reload`, `perm`
- Multi-backend attachment storage: `local`, `webdav`, `s3`, `smb`.
- Runtime safeguards: command permission checks, authorized-guild enforcement, graceful shutdown, and Sentry support.
- Built-in i18n resources (`en`, `ko`).

## Quick Start

1. Install dependencies.
    ```bash
    npm install
    ```
2. Create `.env` from `.env.example` and fill in required values.
    ```bash
    cp .env.example .env
    ```
3. Initialize or migrate DB schema.
    ```bash
    npm run db:setup
    npm run db:migrate
    ```
4. Build and run.
    ```bash
    npm run build
    npm start
    ```

## Development Commands

- `npm run dev`: build then run in dev mode.
- `npm run dev:build:watch`: TypeScript watch build.
- `npm run dev:run:watch`: watch and restart compiled runtime.
- `npm run lint`: run ESLint.
- `npm run format`: apply Prettier formatting.
- `npm run type`: TypeScript type-check only.
- `npm run verify:release`: strict release gate (lint/type/build/audit checks).

Environment variable details are intentionally maintained only in `.env.example`.

## License

ISC

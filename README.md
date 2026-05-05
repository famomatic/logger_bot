[한국어](./README.ko.md) | [English](./README.md)

# Discord Logger Bot

Production-oriented Discord logging bot built with TypeScript, Discord.js v14, and PostgreSQL.
It records guild activity, stores searchable event logs, and exposes operational slash and legacy commands.

## Features

- Message logging: create, edit, delete, bulk delete, reaction add/remove, attachment capture, and startup recovery for missed `messageCreate` logs.
- Guild activity logging: member join/leave/update, ban add/remove, guild updates, invite create/delete, and voice state changes.
- Server object logging: channel create/update/delete/pins, thread create/update/delete, role create/update/delete, emoji create/update/delete, sticker create/update/delete, and scheduled event create/update/delete.
- Log search/export commands, guild/channel message backfill commands, and DLQ redrive for queued log events.
- Message operation commands for sending to users/channels and deleting by channel, guild, user, or count.
- Report commands for guild, channel, and user summaries.
- Log alert commands for add/list/remove/test workflows.
- PostgreSQL storage with startup schema migration and strict `event_logs` schema verification.
- Optional Redis-backed log queue with batching, retry, DLQ redrive, and distributed-mode safeguards.
- Attachment storage through `local`, `webdav`, `s3`, or `smb` providers.
- Slash command permission controls, authorized-guild enforcement, legacy text commands, graceful shutdown, Sentry support, and `en`/`ko` i18n resources.

## Commands

Slash commands currently loaded from `src/command_slash/`:

- Logs: `log-search`, `log-export`, `log-guild-messages`, `log-channel-messages`, `log-dlq-redrive`.
- Alerts: `log-alert-add`, `log-alert-list`, `log-alert-remove`, `log-alert-test`.
- Messages: `message-send-channel`, `message-send-user`, `message-delete-channel`, `message-delete-guild`, `message-delete-number`, `message-delete-user`.
- Reports: `report-guild`, `report-channel`, `report-user`.
- Ops/admin: `ping`, `status`, `reload`, `perm`.

Legacy commands currently loaded from `src/command_legacy/`:

- `ping`, `status`, `reload`, `log-search`, `log-guild-messages`.

## Quick Start

1. Install dependencies.
    ```bash
    npm install
    ```
2. Create `.env` from `.env.example` and fill required values.
    ```bash
    cp .env.example .env
    ```
3. Build the TypeScript output.
    ```bash
    npm run build
    ```
4. Start the compiled bot.
    ```bash
    npm start
    ```

The bot tests the database connection, runs schema migration, verifies `event_logs`, registers global slash commands, loads authorized guilds, initializes the queue, then logs in to Discord.

## Environment

Copy `.env.example` to `.env` and fill the required Discord and PostgreSQL values. PostgreSQL connection options and optional Redis, message recovery, storage, Sentry, super-admin, and legacy-prefix settings are documented in `.env.example`.

## NPM Scripts

- `npm start`: run `dist/index.js`.
- `npm run dev`: build, then run with `NODE_ENV=development`.
- `npm run dev:watch`: watch the compiled runtime with Node.
- `npm run build`: remove `dist/`, then compile with `tsc`.
- `npm run type`: run TypeScript type-check without emitting files.
- `npm run lint`: run ESLint across the repository.
- `npm run lint:strict`: run ESLint with `--max-warnings 0`.
- `npm run lint:scripts`: lint `scripts/**/*.cjs`.
- `npm run format`: format the repository with Prettier.
- `npm run clean`: remove `dist`, `node_modules`, and `package-lock.json`, then reinstall.

## License

PolyForm Noncommercial License 1.0.0. See [LICENSE](./LICENSE).

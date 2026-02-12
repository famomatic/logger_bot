<div style="display: flex; justify-content: center; gap: 1rem; margin-top: 20px;">
  <a href="/README.ko.md" style="text-decoration: none; cursor: pointer; font-weight: bold; color: inherit;">한국어</a>
  <a href="/README.md" style="text-decoration: none; cursor: pointer; font-weight: bold; color: inherit;">English</a>
</div>

# Discord Logger Bot

A TypeScript Discord bot that logs server activity to PostgreSQL. The bot can store attachments via WebDAV and exposes several slash commands for managing messages and searching the logs.

## Features

- **Comprehensive logging** of messages, reactions, member events, voice events, roles, channels, threads and more.
- **PostgreSQL storage** with per-guild partitions and duplicate prevention.
- **Slash commands** for sending or deleting messages, bulk importing history and searching logs with filters.
- **Legacy commands** (`logger ping`, `logger status`) for users with developer levels.
- **WebDAV integration** to save message attachments outside the database.
- **Sentry support** for error reporting.
- Written in **TypeScript** using Discord.js v14.

## Getting Started

1. Install dependencies:
    ```bash
    npm install
    ```
2. Build the project:
    ```bash
    npm run build
    ```
3. Configure environment variables based on `.env.example`.
4. Run database migrations:
    ```bash
    npm run db:migrate
    ```
5. Start the bot:
    ```bash
    npm start
    ```
6. The bot automatically handles sharding when started:
    ```bash
    npm start
    ```

## Environment Variables

Key variables used by the bot:

```dotenv
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
BOT_DB_NAME=
BOT_DB_USER=
BOT_DB_PASSWORD=
PG_HOST=
PG_PORT=
WEBDAV_HOST=
WEBDAV_PORT=
WEBDAV_HTTPS=
WEBDAV_USERNAME=
WEBDAV_PASSWORD=
WEBDAV_BASE_PATH=
SENTRY_DSN=
DEV_LVL1_IDS=
DEV_LVL2_IDS=
DEV_LVL3_IDS=
```

See `.env.example` for the full list.

## License

ISC

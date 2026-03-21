'use strict';
require('dotenv').config();
const { Client } = require('pg');

const dbHost = process.env.PG_HOST || 'localhost';
const dbPort = Number.parseInt(process.env.PG_PORT || '5432', 10);
const dbName = process.env.BOT_DB_NAME;
const dbUser = process.env.BOT_DB_USER;
const dbPassword = process.env.BOT_DB_PASSWORD;
const nodeEnv = process.env.NODE_ENV || 'development';
const dbSsl = (process.env.PG_SSL || '').toLowerCase();
const dbSslRejectUnauthorized = (process.env.PG_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase();

if (!dbName || !dbUser || !dbPassword) {
    console.error('Missing required env vars: BOT_DB_NAME, BOT_DB_USER, BOT_DB_PASSWORD');
    process.exit(1);
}

const sslEnabled = dbSsl === 'true' || dbSsl === '1' || (dbSsl !== 'false' && nodeEnv === 'production');

const client = new Client({
    host: dbHost,
    port: dbPort,
    database: dbName,
    user: dbUser,
    password: dbPassword,
    ssl: sslEnabled
        ? {
              rejectUnauthorized: dbSslRejectUnauthorized !== 'false',
          }
        : false,
});

const statements = [
    `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
    `
    CREATE TABLE IF NOT EXISTS event_logs (
      id BIGSERIAL PRIMARY KEY,
      event_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      event_type VARCHAR(50) NOT NULL,
      guild_id VARCHAR(30) NOT NULL,
      channel_id VARCHAR(30),
      user_id VARCHAR(30),
      target_id VARCHAR(30),
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT event_logs_event_type_nonempty CHECK (length(trim(event_type)) > 0),
      CONSTRAINT event_logs_guild_id_nonempty CHECK (length(trim(guild_id)) > 0)
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_timestamp ON event_logs (guild_id, "timestamp" DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_event_type ON event_logs (guild_id, event_type);`,
    `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_user_id ON event_logs (guild_id, user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_target_id ON event_logs (guild_id, target_id);`,
    `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
    `CREATE INDEX IF NOT EXISTS idx_event_logs_content_gin ON event_logs USING GIN ((data->>'content') gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS idx_event_logs_newcontent_gin ON event_logs USING GIN ((data->>'newContent') gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS idx_event_logs_oldcontent_gin ON event_logs USING GIN ((data->>'oldContent') gin_trgm_ops);`,
    `
    CREATE TABLE IF NOT EXISTS command_permissions (
      guild_id VARCHAR(30) NOT NULL,
      command_name VARCHAR(100) NOT NULL,
      user_id VARCHAR(30) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, command_name, user_id)
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_command_permissions_guild_user ON command_permissions (guild_id, user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_command_permissions_guild_command ON command_permissions (guild_id, command_name);`,
    `CREATE TABLE IF NOT EXISTS authorized_guilds (guild_id VARCHAR(30) PRIMARY KEY);`,
    `
    CREATE TABLE IF NOT EXISTS alert_subscriptions (
      guild_id VARCHAR(30) NOT NULL,
      channel_id VARCHAR(30) NOT NULL,
      category VARCHAR(50) NOT NULL,
      PRIMARY KEY (guild_id, channel_id, category)
    );
    `,
];

async function runMigration() {
    try {
        await client.connect();
        console.log('[migrate] Connected.');
        await client.query('BEGIN');

        for (const stmt of statements) {
            await client.query(stmt);
        }

        await client.query('COMMIT');
        console.log('[migrate] Completed successfully.');
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // ignore rollback error
        }
        console.error('[migrate] Failed:', error);
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => {});
    }
}

runMigration();

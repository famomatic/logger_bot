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
    throw new Error('Missing required env vars: BOT_DB_NAME, BOT_DB_USER, BOT_DB_PASSWORD');
}

const EVENT_ID_NAMESPACE =
    process.env.EVENT_ID_NAMESPACE_UUID || '4f58b70a-9f7f-4c5d-8a6f-7c2d5fef38c1';

const sslEnabled =
    dbSsl === 'true' || dbSsl === '1' || (dbSsl !== 'false' && nodeEnv === 'production');

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

async function ensureSourceIdsAreUnique() {
    const duplicateIdCheck = await client.query(`
      SELECT id, COUNT(*) AS cnt
      FROM event_logs
      GROUP BY id
      HAVING COUNT(*) > 1
      LIMIT 1
    `);

    if ((duplicateIdCheck.rowCount ?? 0) > 0) {
        const dup = duplicateIdCheck.rows[0];
        throw new Error(`Source event_logs has duplicate id=${dup.id} count=${dup.cnt}`);
    }
}

async function run() {
    try {
        await client.connect();
        console.log('[prepare-event-id-cutover] Connected.');
        await client.query('BEGIN');

        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
        await ensureSourceIdsAreUnique();

        await client.query(`
          CREATE TABLE IF NOT EXISTS event_logs_new (
            id BIGSERIAL PRIMARY KEY,
            event_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
            event_type VARCHAR(50) NOT NULL,
            guild_id VARCHAR(30) NOT NULL,
            channel_id VARCHAR(30),
            user_id VARCHAR(30),
            target_id VARCHAR(30),
            timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            CONSTRAINT event_logs_new_event_type_nonempty CHECK (length(trim(event_type)) > 0),
            CONSTRAINT event_logs_new_guild_id_nonempty CHECK (length(trim(guild_id)) > 0)
          );
        `);

        await client.query(
            'CREATE INDEX IF NOT EXISTS idx_event_logs_new_guild_timestamp ON event_logs_new (guild_id, "timestamp" DESC);',
        );
        await client.query(
            'CREATE INDEX IF NOT EXISTS idx_event_logs_new_guild_event_type ON event_logs_new (guild_id, event_type);',
        );
        await client.query(
            'CREATE INDEX IF NOT EXISTS idx_event_logs_new_guild_user_id ON event_logs_new (guild_id, user_id);',
        );
        await client.query(
            'CREATE INDEX IF NOT EXISTS idx_event_logs_new_guild_target_id ON event_logs_new (guild_id, target_id);',
        );
        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
        await client.query(
            "CREATE INDEX IF NOT EXISTS idx_event_logs_new_content_gin ON event_logs_new USING GIN ((data->>'content') gin_trgm_ops);",
        );
        await client.query(
            "CREATE INDEX IF NOT EXISTS idx_event_logs_new_newcontent_gin ON event_logs_new USING GIN ((data->>'newContent') gin_trgm_ops);",
        );
        await client.query(
            "CREATE INDEX IF NOT EXISTS idx_event_logs_new_oldcontent_gin ON event_logs_new USING GIN ((data->>'oldContent') gin_trgm_ops);",
        );

        const copyResult = await client.query(
            `
            INSERT INTO event_logs_new (id, event_id, event_type, guild_id, channel_id, user_id, target_id, "timestamp", data)
            SELECT id, uuid_generate_v5($1::uuid, id::text), event_type, guild_id, channel_id, user_id, target_id, "timestamp", data
            FROM event_logs
            ON CONFLICT (id) DO NOTHING
          `,
            [EVENT_ID_NAMESPACE],
        );

        await client.query(`
          SELECT setval(
            pg_get_serial_sequence('event_logs_new', 'id'),
            COALESCE((SELECT MAX(id) FROM event_logs_new), 1),
            true
          );
        `);

        const validation = await client.query(`
          SELECT
            (SELECT COUNT(*)::bigint FROM event_logs) AS source_count,
            (SELECT COUNT(*)::bigint FROM event_logs_new) AS target_count,
            (SELECT COUNT(*)::bigint FROM event_logs_new WHERE event_id IS NULL) AS null_event_id_count,
            (SELECT COUNT(DISTINCT event_id)::bigint FROM event_logs_new) AS distinct_event_id_count
        `);

        await client.query('COMMIT');

        const stats = validation.rows[0];
        console.log(
            `[prepare-event-id-cutover] copied=${copyResult.rowCount ?? 0}, source=${stats.source_count}, target=${stats.target_count}, null_event_id=${stats.null_event_id_count}, distinct_event_id=${stats.distinct_event_id_count}`,
        );
        console.log('[prepare-event-id-cutover] Completed successfully.');
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // ignore rollback error
        }
        console.error('[prepare-event-id-cutover] Failed:', error);
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => {});
    }
}

run();

'use strict';
require('dotenv').config();
const { Client } = require('pg');

const dbHost = process.env.PG_HOST || 'localhost';
const dbPort = parseInt(process.env.PG_PORT || '5432', 10);
const botDbName = process.env.BOT_DB_NAME;
const botDbUser = process.env.BOT_DB_USER;
const botDbPassword = process.env.BOT_DB_PASSWORD;

if (!botDbName || !botDbUser || !botDbPassword) {
    console.error(
        'Error: Missing required environment variables (BOT_DB_NAME, BOT_DB_USER, BOT_DB_PASSWORD).',
    );
    process.exit(1);
}

const countRowsQuery = `
SELECT COUNT(*)::int AS count
FROM event_logs
WHERE jsonb_typeof(data->'attachments') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(data->'attachments') AS elem
    WHERE elem ? 'webdavPath'
  );
`;

const migrateQuery = `
UPDATE event_logs
SET data = jsonb_set(
  data,
  '{attachments}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem ? 'webdavPath' AND NOT (elem ? 'storagePath')
          THEN (elem - 'webdavPath') || jsonb_build_object('storagePath', elem->'webdavPath')
        ELSE elem - 'webdavPath'
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(data->'attachments') WITH ORDINALITY AS arr(elem, ord)
  ),
  true
)
WHERE jsonb_typeof(data->'attachments') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(data->'attachments') AS elem
    WHERE elem ? 'webdavPath'
  );
`;

async function run() {
    const client = new Client({
        user: botDbUser,
        password: botDbPassword,
        host: dbHost,
        port: dbPort,
        database: botDbName,
        ssl: false,
    });

    try {
        await client.connect();
        console.log('[migration] Connected to database.');

        const before = await client.query(countRowsQuery);
        const targetRows = before.rows[0]?.count ?? 0;
        console.log(`[migration] Rows containing attachments.webdavPath: ${targetRows}`);

        if (targetRows === 0) {
            console.log('[migration] Nothing to migrate.');
            return;
        }

        await client.query('BEGIN');
        const result = await client.query(migrateQuery);
        await client.query('COMMIT');

        console.log(`[migration] Updated rows: ${result.rowCount ?? 0}`);

        const after = await client.query(countRowsQuery);
        const remaining = after.rows[0]?.count ?? 0;
        console.log(`[migration] Remaining rows with attachments.webdavPath: ${remaining}`);
        console.log('[migration] Done.');
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Ignore rollback errors
        }
        console.error('[migration] Failed:', error);
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => {});
    }
}

run();

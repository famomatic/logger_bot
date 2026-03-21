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

function buildBackupTableName(now = new Date()) {
    const pad2 = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;
    return `event_logs_backup_${stamp}`;
}

async function validatePreparedTable() {
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'event_logs_new'
      ) AS exists
    `);
    if (!tableCheck.rows[0]?.exists) {
        throw new Error(
            'event_logs_new table does not exist. Run db:prepare:event-id-cutover first.',
        );
    }

    const validation = await client.query(`
      SELECT
        (SELECT COUNT(*)::bigint FROM event_logs) AS source_count,
        (SELECT COUNT(*)::bigint FROM event_logs_new) AS target_count,
        (SELECT COUNT(*)::bigint FROM event_logs_new WHERE event_id IS NULL) AS null_event_id_count,
        (SELECT COUNT(DISTINCT event_id)::bigint FROM event_logs_new) AS distinct_event_id_count
    `);

    const stats = validation.rows[0];
    const source = BigInt(stats.source_count);
    const target = BigInt(stats.target_count);
    const nullEventId = BigInt(stats.null_event_id_count);
    const distinctEventId = BigInt(stats.distinct_event_id_count);

    if (target < source) {
        throw new Error(
            `event_logs_new is not fully backfilled (source=${source}, target=${target})`,
        );
    }
    if (nullEventId !== 0n) {
        throw new Error(`event_logs_new has NULL event_id rows (${nullEventId})`);
    }
    if (distinctEventId !== target) {
        throw new Error(
            `event_logs_new has duplicate event_id values (distinct=${distinctEventId}, rows=${target})`,
        );
    }
}

async function run() {
    const backupTableName = buildBackupTableName();
    try {
        await client.connect();
        console.log('[cutover-event-logs-swap] Connected.');
        await validatePreparedTable();

        await client.query('BEGIN');
        await client.query('LOCK TABLE event_logs IN ACCESS EXCLUSIVE MODE;');
        await client.query('LOCK TABLE event_logs_new IN ACCESS EXCLUSIVE MODE;');

        // Re-check under lock before swap.
        await validatePreparedTable();

        await client.query(`ALTER TABLE event_logs RENAME TO ${backupTableName};`);
        await client.query('ALTER TABLE event_logs_new RENAME TO event_logs;');

        await client.query('COMMIT');
        console.log(`[cutover-event-logs-swap] Completed. Backup table: ${backupTableName}`);
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // ignore rollback error
        }
        console.error('[cutover-event-logs-swap] Failed:', error);
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => {});
    }
}

run();

import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

/**
 * 필수 테이블/인덱스/확장 모듈 존재를 보장하는 스키마 마이그레이션을 수행합니다.
 */
export async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
        await client.query(`
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
    `);
        await client.query(
            `ALTER TABLE event_logs DROP CONSTRAINT IF EXISTS event_logs_unique_guild_event_target;`,
        );
        await client.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_logs_message_create_unique_target
             ON event_logs (guild_id, event_type, target_id)
             WHERE event_type = 'messageCreate';`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_timestamp ON event_logs (guild_id, "timestamp" DESC);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_event_type ON event_logs (guild_id, event_type);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_user_id ON event_logs (guild_id, user_id);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_guild_target_id ON event_logs (guild_id, target_id);`,
        );

        await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_content_gin ON event_logs USING GIN ((data->>'content') gin_trgm_ops);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_newcontent_gin ON event_logs USING GIN ((data->>'newContent') gin_trgm_ops);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_event_logs_oldcontent_gin ON event_logs USING GIN ((data->>'oldContent') gin_trgm_ops);`,
        );

        const legacyConstraints = await client.query<{
            schema_name: string;
            table_name: string;
            constraint_name: string;
        }>(
            `
            WITH event_log_tables AS (
                SELECT 'event_logs'::regclass::oid AS oid
                UNION
                SELECT inhrelid
                FROM pg_inherits
                WHERE inhparent = 'event_logs'::regclass
            )
            SELECT
                ns.nspname AS schema_name,
                cl.relname AS table_name,
                con.conname AS constraint_name
            FROM pg_constraint con
            JOIN pg_class cl ON cl.oid = con.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            WHERE con.contype = 'u'
              AND con.conrelid IN (SELECT oid FROM event_log_tables)
              AND pg_get_constraintdef(con.oid) LIKE 'UNIQUE (guild_id, event_type, target_id)%'
            `,
        );

        for (const row of legacyConstraints.rows) {
            const qualifiedTable = `${quoteIdentifier(row.schema_name)}.${quoteIdentifier(row.table_name)}`;
            const constraintName = quoteIdentifier(row.constraint_name);
            await client.query(
                `ALTER TABLE ${qualifiedTable} DROP CONSTRAINT IF EXISTS ${constraintName};`,
            );
            logger.warn(
                `Dropped legacy UNIQUE constraint ${row.constraint_name} on ${row.schema_name}.${row.table_name}.`,
            );
        }

        const legacyIndexes = await client.query<{
            schema_name: string;
            index_name: string;
            index_def: string;
        }>(
            `
            WITH event_log_tables AS (
                SELECT 'event_logs'::regclass::oid AS oid
                UNION
                SELECT inhrelid
                FROM pg_inherits
                WHERE inhparent = 'event_logs'::regclass
            )
            SELECT
                ns.nspname AS schema_name,
                idx.relname AS index_name,
                pg_get_indexdef(idx.oid) AS index_def
            FROM pg_index i
            JOIN pg_class idx ON idx.oid = i.indexrelid
            JOIN pg_class tbl ON tbl.oid = i.indrelid
            JOIN pg_namespace ns ON ns.oid = idx.relnamespace
            WHERE i.indisunique = true
              AND i.indrelid IN (SELECT oid FROM event_log_tables)
              AND i.indpred IS NULL
              AND pg_get_indexdef(idx.oid) LIKE 'CREATE UNIQUE INDEX % ON % (guild_id, event_type, target_id)%'
              AND NOT EXISTS (
                  SELECT 1
                  FROM pg_constraint c
                  WHERE c.conindid = i.indexrelid
              )
            `,
        );

        for (const row of legacyIndexes.rows) {
            const qualifiedIndex = `${quoteIdentifier(row.schema_name)}.${quoteIdentifier(row.index_name)}`;
            await client.query(`DROP INDEX IF EXISTS ${qualifiedIndex};`);
            logger.warn(`Dropped legacy UNIQUE index ${row.schema_name}.${row.index_name}.`);
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS command_permissions (
                guild_id VARCHAR(30) NOT NULL,
                command_name VARCHAR(100) NOT NULL,
                user_id VARCHAR(30) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (guild_id, command_name, user_id)
            );
        `);
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_command_permissions_guild_user ON command_permissions (guild_id, user_id);`,
        );
        await client.query(
            `CREATE INDEX IF NOT EXISTS idx_command_permissions_guild_command ON command_permissions (guild_id, command_name);`,
        );
        await client.query(`
            CREATE TABLE IF NOT EXISTS authorized_guilds (
                guild_id VARCHAR(30) PRIMARY KEY
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS alert_subscriptions (
                guild_id VARCHAR(30) NOT NULL,
                channel_id VARCHAR(30) NOT NULL,
                category VARCHAR(50) NOT NULL,
                PRIMARY KEY (guild_id, channel_id, category)
            );
        `);

        await client.query('COMMIT');
        logger.info('Database migration check completed successfully.');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Database migration failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * 애플리케이션 종료 시 DB 풀을 정상 종료합니다.
 */
export async function destroyDatabase() {
    logger.info('Disconnecting database pool...');
    await pool.end();
    logger.info('Database pool disconnected.');
}

/**
 * 시작 시 DB 연결 가능 여부를 확인합니다.
 */
export async function testDatabaseConnection() {
    try {
        const client = await pool.connect();
        logger.info('Database connection test successful.');
        client.release();
    } catch (error) {
        logger.error('Database connection test failed:', error);
        throw error;
    }
}

/**
 * event_logs 스키마 핵심 제약/인덱스/확장을 점검합니다.
 * 실패 시 예외를 던져 부팅을 중단합니다.
 */
export async function verifyEventLogsSchemaStrict(): Promise<void> {
    const client = await pool.connect();
    try {
        const tableExists = await client.query<{ exists: boolean }>(
            `
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = 'event_logs'
            ) AS exists
            `,
        );
        if (!tableExists.rows[0]?.exists) {
            throw new Error('event_logs table is missing');
        }

        const columnRows = await client.query<{
            column_name: string;
            data_type: string;
            is_nullable: 'YES' | 'NO';
            column_default: string | null;
        }>(
            `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'event_logs'
            `,
        );
        const columns = new Map(columnRows.rows.map((r) => [r.column_name, r]));
        const requiredColumns = ['id', 'event_id', 'event_type', 'guild_id', 'data', 'timestamp'];
        for (const name of requiredColumns) {
            if (!columns.has(name)) {
                throw new Error(`event_logs.${name} column is missing`);
            }
        }

        const eventIdColumn = columns.get('event_id');
        if (eventIdColumn?.data_type !== 'uuid' || eventIdColumn.is_nullable !== 'NO') {
            throw new Error('event_logs.event_id must be UUID NOT NULL');
        }

        const dataColumn = columns.get('data');
        if (dataColumn?.data_type !== 'jsonb' || dataColumn.is_nullable !== 'NO') {
            throw new Error('event_logs.data must be JSONB NOT NULL');
        }

        const uniqueEventId = await client.query<{ ok: boolean }>(
            `
            SELECT EXISTS (
              SELECT 1
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = 'public'
                AND t.relname = 'event_logs'
                AND c.contype = 'u'
                AND c.conname = 'event_logs_event_id_key'
            ) AS ok
            `,
        );
        if (!uniqueEventId.rows[0]?.ok) {
            throw new Error('UNIQUE constraint on event_logs.event_id is missing');
        }

        const extensionRows = await client.query<{ extname: string }>(
            `
            SELECT extname
            FROM pg_extension
            WHERE extname IN ('pgcrypto', 'pg_trgm')
            `,
        );
        const extensions = new Set(extensionRows.rows.map((r) => r.extname));
        if (!extensions.has('pgcrypto')) {
            throw new Error('pgcrypto extension is missing');
        }
        if (!extensions.has('pg_trgm')) {
            throw new Error('pg_trgm extension is missing');
        }

        const indexRows = await client.query<{ indexname: string }>(
            `
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'event_logs'
            `,
        );
        const indexes = new Set(indexRows.rows.map((r) => r.indexname));
        const requiredIndexes = [
            'idx_event_logs_guild_timestamp',
            'idx_event_logs_guild_event_type',
            'idx_event_logs_guild_user_id',
            'idx_event_logs_guild_target_id',
            'idx_event_logs_content_gin',
            'idx_event_logs_newcontent_gin',
            'idx_event_logs_oldcontent_gin',
        ];
        for (const name of requiredIndexes) {
            if (!indexes.has(name)) {
                throw new Error(`Required index is missing: ${name}`);
            }
        }
    } finally {
        client.release();
    }
}

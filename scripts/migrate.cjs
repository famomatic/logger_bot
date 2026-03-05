const { default: pool } = require('../dist/db/database.js');
const { logger } = require('../dist/utils/logger.js');

const createEventLogsTableQuery = `
CREATE TABLE IF NOT EXISTS event_logs (
  id SERIAL, -- 파티셔닝 사용 시 PRIMARY KEY는 파티션 키를 포함해야 함. 또는 각 파티션에서 로컬 PK를 갖도록 수정 필요. 여기서는 일단 SERIAL로 유지하고 PK 제약조건 제거. 필요 시 추후 조정.
  event_type VARCHAR(50) NOT NULL, -- 이벤트 종류 (e.g., 'messageCreate', 'guildMemberAdd')
  guild_id VARCHAR(30) NOT NULL,    -- 서버 ID (Partition Key)
  channel_id VARCHAR(30),           -- 채널 ID (Nullable)
  user_id VARCHAR(30),              -- 사용자 ID (Nullable)
  target_id VARCHAR(30),            -- 대상 ID (Nullable, e.g., banned user, deleted message)
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 이벤트 발생 시간
  data JSONB,
  -- UNIQUE 제약 조건 추가: guild_id, event_type, target_id 조합은 고유해야 함
  CONSTRAINT event_logs_unique_guild_event_target UNIQUE (guild_id, event_type, target_id)
) PARTITION BY LIST (guild_id); -- guild_id를 기준으로 리스트 파티셔닝 적용
`;
// PRIMARY KEY (id, guild_id) -- 파티션 키를 포함한 복합키 또는 파티션별 로컬 PK 고려

const createIndexesQuery = `
-- CREATE INDEX IF NOT EXISTS idx_event_logs_guild_id ON event_logs (guild_id); -- 파티션 키 인덱스는 보통 불필요하거나 다르게 관리
CREATE INDEX IF NOT EXISTS idx_event_logs_event_type ON event_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_event_logs_timestamp ON event_logs (timestamp);
CREATE INDEX IF NOT EXISTS idx_event_logs_user_id ON event_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_target_id ON event_logs (target_id);
`;

// --- Added User Tokens Table and Trigger ---
const createUserTokensTableQuery = `
CREATE TABLE IF NOT EXISTS user_tokens (
    user_id VARCHAR(30) PRIMARY KEY,     -- Discord User ID
    access_token TEXT NOT NULL,          -- Discord OAuth2 Access Token
    refresh_token TEXT NOT NULL,         -- Discord OAuth2 Refresh Token
    token_expiry TIMESTAMPTZ NOT NULL,   -- Timestamp when the access token expires
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() -- Timestamp of the last update
);
`;

const createUpdatedAtTriggerFunctionQuery = `
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';
`;

const createUserTokensUpdatedAtTriggerQuery = `
DO $$
BEGIN
   IF NOT EXISTS (
       SELECT 1 FROM pg_trigger 
       WHERE tgname = 'update_user_tokens_updated_at'
   ) THEN
      CREATE TRIGGER update_user_tokens_updated_at
      BEFORE UPDATE ON user_tokens
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
   END IF;
END $$;
`;

// --- Authorized Guilds Table ---
const createAuthorizedGuildsTableQuery = `
CREATE TABLE IF NOT EXISTS authorized_guilds (
    guild_id VARCHAR(30) PRIMARY KEY
);
`;

// --- Alert Subscriptions Table ---
const createAlertSubscriptionsTableQuery = `
CREATE TABLE IF NOT EXISTS alert_subscriptions (
    guild_id VARCHAR(30) NOT NULL,
    channel_id VARCHAR(30) NOT NULL,
    category VARCHAR(50) NOT NULL,
    PRIMARY KEY (guild_id, channel_id, category)
);
`;

const createCommandPermissionsTableQuery = `
CREATE TABLE IF NOT EXISTS command_permissions (
    guild_id VARCHAR(30) NOT NULL,
    command_name VARCHAR(100) NOT NULL,
    user_id VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, command_name, user_id)
);
`;

const createCommandPermissionsIndexesQuery = `
CREATE INDEX IF NOT EXISTS idx_command_permissions_guild_user
ON command_permissions (guild_id, user_id);

CREATE INDEX IF NOT EXISTS idx_command_permissions_guild_command
ON command_permissions (guild_id, command_name);
`;
// ---------------------------------------------

(async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        logger.info('Creating event_logs table if it does not exist...');
        await client.query(createEventLogsTableQuery);
        logger.success('Table event_logs checked/created.');

        logger.info('Creating event_logs indexes if they do not exist...');
        await client.query(createIndexesQuery);
        logger.success('Indexes for event_logs checked/created.');

        // --- Add user_tokens table and trigger creation ---
        logger.info('Creating user_tokens table if it does not exist...');
        await client.query(createUserTokensTableQuery);
        logger.success('Table user_tokens checked/created.');

        logger.info('Creating updated_at trigger function if it does not exist...');
        await client.query(createUpdatedAtTriggerFunctionQuery);
        logger.success('Function update_updated_at_column checked/created.');

        logger.info('Creating updated_at trigger for user_tokens if it does not exist...');
        await client.query(createUserTokensUpdatedAtTriggerQuery);
        logger.success('Trigger update_user_tokens_updated_at checked/created.');

        // --- Authorized guilds table creation ---
        logger.info('Creating authorized_guilds table if it does not exist...');
        await client.query(createAuthorizedGuildsTableQuery);
        logger.success('Table authorized_guilds checked/created.');

        logger.info('Creating alert_subscriptions table if it does not exist...');
        await client.query(createAlertSubscriptionsTableQuery);
        logger.success('Table alert_subscriptions checked/created.');

        logger.info('Creating command_permissions table if it does not exist...');
        await client.query(createCommandPermissionsTableQuery);
        logger.success('Table command_permissions checked/created.');

        logger.info('Creating command_permissions indexes if they do not exist...');
        await client.query(createCommandPermissionsIndexesQuery);
        logger.success('Indexes for command_permissions checked/created.');
        // ---------------------------------------------------

        await client.query('COMMIT');
        logger.success('Database migration completed successfully!');
        // 마이그레이션 완료 후 프로세스 종료 (선택적)
        // process.exit(0); // ts-node --esm 모드에서는 pool 연결 종료 전에 exit하면 문제가 될 수 있음
        // Pool 명시적 종료 필요
        client.release();
        await pool.end();
        logger.info('Database pool ended for migration script.');
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('❌ Migration Error:', error);
        console.error('❌ Error type:', typeof error);
        console.error('❌ Error keys:', Object.getOwnPropertyNames(error));
        process.exit(1);
    }
})();

import pkg from 'pg';

import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

const { Pool } = pkg;

export const pool = new Pool({
    user: config.dbUser,
    password: config.dbPassword,
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    ssl: config.dbSsl ? { rejectUnauthorized: config.dbSslRejectUnauthorized } : false,
});

pool.on('connect', () => {
    logger.info('Database pool connected');
});

pool.on('error', (err, client) => {
    logger.error('Unexpected error on idle database client', { error: err, clientInfo: client });
});

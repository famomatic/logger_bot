'use strict';
require('dotenv').config();
const { Client } = require('pg');

const dbHost = process.env.PG_HOST || 'localhost';
const dbPort = process.env.PG_PORT || 5432;
const botDbName = process.env.BOT_DB_NAME;
const botDbUser = process.env.BOT_DB_USER;
const botDbPassword = process.env.BOT_DB_PASSWORD;

if (!botDbName || !botDbUser || !botDbPassword) {
    console.error('Error: Missing required environment variables.');
    process.exit(1);
}

async function setupDatabase() {
    let client;
    let botDbClient;
    try {
        client = new Client({
            user: botDbUser,
            password: botDbPassword,
            host: dbHost,
            port: dbPort,
            database: 'postgres',
        });
        await client.connect();
        console.log(`Connected to PostgreSQL as ${botDbUser}.`);

        const dbExists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
            botDbName,
        ]);
        if (dbExists.rowCount === 0) {
            await client.query(`CREATE DATABASE "${botDbName}"`);
            console.log(`Database ${botDbName} created.`);
        } else {
            console.log(`Database ${botDbName} already exists.`);
        }
        await client.end();

        botDbClient = new Client({
            user: botDbUser,
            password: botDbPassword,
            host: dbHost,
            port: dbPort,
            database: botDbName,
        });
        await botDbClient.connect();
        await botDbClient.query(
            `GRANT ALL PRIVILEGES ON DATABASE "${botDbName}" TO "${botDbUser}"`,
        );
        console.log('Database privileges granted (if applicable).');
    } catch (err) {
        console.error('Error during database setup:', err);
        process.exitCode = 1;
    } finally {
        if (client && !client.ended) {
            await client.end().catch((e) => console.error('Error closing initial client:', e));
        }
        if (botDbClient && !botDbClient.ended) {
            await botDbClient.end().catch((e) => console.error('Error closing bot DB client:', e));
        }
    }
}

setupDatabase();

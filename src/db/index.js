/**
 * src/db/index.js
 * PostgreSQL connection pool + Drizzle ORM instance.
 * Uses SSL for Supabase. Exports `pool` for raw transactions.
 */
const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const schema = require('./schema');
const logger = require('../utils/logger');

const isProduction = process.env.NODE_ENV === 'production';

// Use pooler URL in production (Supabase Transaction mode, port 6543)
// Use direct URL in development (port 5432)
const connectionString = isProduction
  ? (process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL)
  : process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // strict SSL in prod, relaxed in dev
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000, // kill runaway queries after 30s
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New DB client connected to pool');
});

const db = drizzle(pool, { schema });

const connectDB = async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1'); // basic liveness check
    client.release();
    logger.info('✅ Database connected successfully', {
      host: new URL(connectionString).hostname,
      ssl: isProduction,
    });
  } catch (error) {
    logger.error('❌ Database connection failed', { error: error.message });
    process.exit(1);
  }
};

module.exports = { db, pool, connectDB };

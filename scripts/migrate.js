#!/usr/bin/env node
/**
 * scripts/migrate.js
 * Safe production migration runner.
 *
 * Usage:
 *   node scripts/migrate.js          # runs all pending migrations
 *   node scripts/migrate.js --dry    # prints SQL without executing
 *
 * Always make a DB backup before running migrations in production.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

async function run() {
  const isDry = process.argv.includes('--dry');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Create migrations tracking table if needed
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id        SERIAL PRIMARY KEY,
        filename  VARCHAR(255) UNIQUE NOT NULL,
        ran_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Get already-run migrations
    const { rows: ran } = await client.query('SELECT filename FROM _migrations');
    const ranSet = new Set(ran.map(r => r.filename));

    // Get all migration files sorted
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const pending = files.filter(f => !ranSet.has(f));

    if (pending.length === 0) {
      console.log('✅ No pending migrations.');
      return;
    }

    console.log(`📋 Pending migrations: ${pending.join(', ')}\n`);

    for (const filename of pending) {
      const filepath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filepath, 'utf8');

      console.log(`▶ Running: ${filename}`);
      if (isDry) {
        console.log('--- DRY RUN ---');
        console.log(sql.slice(0, 500) + (sql.length > 500 ? '\n...(truncated)' : ''));
        console.log('--- END ---\n');
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
        console.log(`✅ Done: ${filename}\n`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed: ${filename}`);
        console.error(err.message);
        process.exit(1);
      }
    }

    if (!isDry) {
      console.log('🎉 All migrations complete.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});

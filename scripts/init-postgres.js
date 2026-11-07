/* eslint-disable no-console, @typescript-eslint/no-var-requires */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  closePostgresPool,
  getPostgresPool,
} = require('../src/lib/postgres-pool');

const MIGRATION_BASELINE_CUTOFF = '008_web_push_notifications.sql';
const MIGRATION_LOCK = 742649067;

async function initPostgresDatabase() {
  const migrationsDir = path.join(__dirname, '../migrations/postgres');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (migrationFiles.length === 0) {
    throw new Error(`No PostgreSQL migrations found in ${migrationsDir}`);
  }

  const client = await getPostgresPool().connect();
  let locked = false;
  try {
    // Serialize migrations when multiple application instances start together.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    locked = true;
    const existing = await client.query(
      "SELECT to_regclass('users') AS table_name"
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY, applied_at BIGINT NOT NULL
      )
    `);
    const result = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(result.rows.map((row) => row.filename));

    // Retain compatibility with databases initialized before migration tracking.
    if (existing.rows[0].table_name && applied.size === 0) {
      for (const filename of migrationFiles) {
        if (filename.localeCompare(MIGRATION_BASELINE_CUTOFF) < 0) {
          await client.query(
            'INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
            [filename, Date.now()]
          );
          applied.add(filename);
        }
      }
    }

    for (const filename of migrationFiles) {
      if (applied.has(filename)) continue;
      console.log(`Applying PostgreSQL migration: ${filename}`);
      await client.query('BEGIN');
      try {
        // PostgreSQL parses the complete SQL file, including quoted semicolons and comments.
        await client.query(
          fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
        );
        await client.query(
          'INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)',
          [filename, Date.now()]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    const username = process.env.USERNAME || 'admin';
    const password = process.env.PASSWORD || '123456789';
    const passwordHash = crypto
      .createHash('sha256')
      .update(password)
      .digest('hex');
    await client.query(
      `
      INSERT INTO users (username, password_hash, role, created_at, playrecord_migrated, favorite_migrated, skip_migrated)
      VALUES ($1, $2, 'owner', $3, 1, 1, 1)
      ON CONFLICT (username) DO NOTHING
    `,
      [username, passwordHash, Date.now()]
    );
    console.log('PostgreSQL database is ready.');
  } finally {
    try {
      if (locked)
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    } finally {
      client.release();
    }
  }
}

module.exports = { initPostgresDatabase };

if (require.main === module) {
  require('@next/env').loadEnvConfig(
    process.cwd(),
    process.env.NODE_ENV !== 'production'
  );
  initPostgresDatabase()
    .catch((error) => {
      console.error('PostgreSQL initialization failed:', error.message);
      process.exitCode = 1;
    })
    .finally(closePostgresPool);
}

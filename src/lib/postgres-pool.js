/* eslint-disable no-console, @typescript-eslint/no-var-requires */

const { Pool, types } = require('pg');

// Share a pool across Next.js bundles, development reloads and initialization scripts.
function getPostgresPool() {
  if (!globalThis.__moontvPostgresPool) {
    const connectionString =
      process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL or POSTGRES_URL must be set for PostgreSQL storage'
      );
    }

    const max = Number(process.env.POSTGRES_POOL_MAX || 10);
    if (!Number.isSafeInteger(max) || max < 1) {
      throw new Error('POSTGRES_POOL_MAX must be a positive integer');
    }

    const pool = new Pool({
      connectionString,
      max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      types: {
        getTypeParser(oid, format) {
          if (oid === 20 && format !== 'binary') {
            return (value) => {
              const parsed = Number(value);
              return Number.isSafeInteger(parsed) ? parsed : value;
            };
          }
          return types.getTypeParser(oid, format);
        },
      },
    });
    pool.on('error', (error) => {
      console.error('PostgreSQL idle connection error:', error.message);
    });
    globalThis.__moontvPostgresPool = pool;
  }
  return globalThis.__moontvPostgresPool;
}

async function closePostgresPool() {
  const pool = globalThis.__moontvPostgresPool;
  delete globalThis.__moontvPostgresPool;
  if (pool) await pool.end();
}

module.exports = { getPostgresPool, closePostgresPool };

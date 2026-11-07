/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Pool, PoolClient, QueryResult } from 'pg';

import type {
  D1PreparedStatement,
  D1Result,
  DatabaseAdapter,
} from './d1-adapter';
import { getPostgresPool } from './postgres-pool';

// Skip quoted strings, identifiers and comments when translating SQLite placeholders.
const SQL_TOKENS =
  /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\$([a-zA-Z_][\w]*)?\$[\s\S]*?\$\1\$|\$\d+|\?/g;

function convertQuery(query: string): string {
  // Native PostgreSQL queries can contain JSON operators such as `tags ? $1`.
  const tokens = query.match(SQL_TOKENS) || [];
  if (tokens.some((token) => /^\$\d+$/.test(token))) return query;

  let index = 0;
  return query.replace(SQL_TOKENS, (token) =>
    token === '?' ? `$${++index}` : token
  );
}

function toResult<T>(result: QueryResult): D1Result<T> {
  return {
    success: true,
    meta: { changes: result.rowCount || 0, last_row_id: null },
    results: result.rows,
  };
}

/** Standard PostgreSQL connection pool with the application's D1-compatible API. */
export class PostgresAdapter implements DatabaseAdapter {
  readonly dialect = 'postgres' as const;
  constructor(private pool: Pool = getPostgresPool()) {}

  prepare(query: string): D1PreparedStatement {
    return new PostgresPreparedStatement(this.pool, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    if (statements.length === 0) return [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results: D1Result[] = [];
      for (const statement of statements) {
        if (!(statement instanceof PostgresPreparedStatement)) {
          throw new Error('Postgres batch requires PostgreSQL statements');
        }
        results.push(toResult(await statement.execute(client)));
      }
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

class PostgresPreparedStatement implements D1PreparedStatement {
  private params: any[] = [];

  constructor(private pool: Pool, private query: string) {}

  bind(...values: any[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = any>(colName?: string): Promise<T | null> {
    const result = await this.execute();
    const row = result.rows[0];
    if (!row) return null;
    return colName ? row[colName] ?? null : row;
  }

  async run<T = any>(): Promise<D1Result<T>> {
    return toResult<T>(await this.execute());
  }

  async all<T = any>(): Promise<D1Result<T>> {
    return toResult<T>(await this.execute());
  }

  execute(client?: PoolClient): Promise<QueryResult> {
    return (client || this.pool).query(convertQuery(this.query), this.params);
  }
}

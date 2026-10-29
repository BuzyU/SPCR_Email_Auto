import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { sha256Hex } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

export interface QueryResultRow {
  [column: string]: any;
}

export interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }>;
}

export interface Database extends QueryExecutor {
  readonly driverType: 'pg' | 'pglite';
  withTransaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class NodePgDatabase implements Database {
  public readonly driverType = 'pg' as const;
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number }> {
    const res = await this.pool.query(sql, params);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
  }

  async withTransaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const executor: QueryExecutor = {
        async query<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
        },
      };
      const result = await fn(executor);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PGliteDatabase implements Database {
  public readonly driverType = 'pglite' as const;
  private pglite: PGlite;
  // Serialize explicit transactions on single-engine PGlite so concurrent Promise.all calls
  // faithfully emulate PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) without interleaving BEGIN blocks!
  private txMutex: Promise<void> = Promise.resolve();

  constructor(dataDir?: string) {
    if (dataDir && dataDir !== ':memory:') {
      fs.mkdirSync(path.dirname(dataDir), { recursive: true });
      this.pglite = new PGlite(dataDir);
    } else {
      this.pglite = new PGlite();
    }
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number }> {
    const normalizedParams = params.map((p) => (Buffer.isBuffer(p) ? new Uint8Array(p) : p));
    const res = await this.pglite.query<T>(sql, normalizedParams);
    return {
      rows: res.rows,
      rowCount: res.affectedRows ?? res.rows.length,
    };
  }

  async withTransaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    let releaseMutex!: () => void;
    const prev = this.txMutex;
    this.txMutex = new Promise<void>((resolve) => {
      releaseMutex = resolve;
    });
    await prev;
    try {
      return await this.pglite.transaction(async (tx) => {
        const executor: QueryExecutor = {
          async query<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
            const normalizedParams = params.map((p) => (Buffer.isBuffer(p) ? new Uint8Array(p) : p));
            const res = await tx.query<R>(sql, normalizedParams);
            return {
              rows: res.rows,
              rowCount: res.affectedRows ?? res.rows.length,
            };
          },
        };
        return await fn(executor);
      });
    } finally {
      releaseMutex();
    }
  }

  async close(): Promise<void> {
    await this.pglite.close();
  }
}

export async function createDatabase(databaseUrl: string): Promise<Database> {
  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    return new NodePgDatabase(databaseUrl);
  }
  if (databaseUrl === 'pglite://memory' || databaseUrl === ':memory:') {
    return new PGliteDatabase(':memory:');
  }
  const dir = databaseUrl.replace(/^pglite:\/\//, '');
  return new PGliteDatabase(path.resolve(dir));
}

export async function runMigrations(db: Database, migrationsDir?: string): Promise<string[]> {
  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateDirs = [
    path.resolve(baseDir, '../migrations'),
    path.resolve(baseDir, '../../migrations'),
    path.resolve(process.cwd(), 'migrations'),
  ];
  const resolvedDir = migrationsDir || candidateDirs.find((d) => fs.existsSync(d)) || candidateDirs[0]!;

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum_sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = fs
    .readdirSync(resolvedDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    const sqlContent = fs.readFileSync(path.join(resolvedDir, file), 'utf8');
    const checksum = sha256Hex(sqlContent);
    const existing = await db.query<{ version: string; checksum_sha256: string }>(
      'SELECT version, checksum_sha256 FROM schema_migrations WHERE version = $1',
      [file]
    );
    const row = existing.rows[0];
    if (row) {
      if (row.checksum_sha256 !== checksum) {
        throw new Error(`Migration checksum mismatch for ${file}: expected ${row.checksum_sha256}, got ${checksum}`);
      }
      continue;
    }

    await db.withTransaction(async (tx) => {
      // PGlite `.query()` executes single statements; handle multi-statement SQL cleanly across both drivers
      const statements = sqlContent
        .split(/;\s*(?:\r?\n|$)/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^--/.test(s.replace(/^(--[^\n]*\n)+/, '').trim() === '' ? '--' : 'x'));
      for (const stmt of statements) {
        const cleaned = stmt.replace(/^(?:\s*--[^\r\n]*\r?\n)+/, '').trim();
        if (!cleaned) continue;
        await tx.query(cleaned);
      }
      await tx.query('INSERT INTO schema_migrations (version, checksum_sha256) VALUES ($1, $2)', [file, checksum]);
    });

    applied.push(file);
    logger.info('migration_applied', { version: file });
  }

  return applied;
}

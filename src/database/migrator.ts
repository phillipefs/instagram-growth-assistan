import type { SqliteDatabase } from './connection.js';
import { nowIso } from './util.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: (db: SqliteDatabase) => void;
}

export interface MigrationStatus {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: string | null;
  readonly pending: boolean;
}

interface MigrationRow {
  readonly version: number;
  readonly name: string;
  readonly applied_at: string;
}

function ensureMigrationsTable(db: SqliteDatabase): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  );
}

function appliedVersions(db: SqliteDatabase): Map<number, MigrationRow> {
  const rows = db.prepare('SELECT version, name, applied_at FROM schema_migrations').all() as MigrationRow[];
  return new Map(rows.map((row) => [row.version, row]));
}

/**
 * Aplica as migrações pendentes em ordem, cada uma em sua própria transação.
 * Retorna as versões efetivamente aplicadas nesta chamada.
 */
export function runMigrations(db: SqliteDatabase, migrations: readonly Migration[]): number[] {
  ensureMigrationsTable(db);
  const applied = appliedVersions(db);
  const pending = [...migrations]
    .filter((migration) => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version);

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  const executed: number[] = [];
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      insert.run(migration.version, migration.name, nowIso());
    })();
    executed.push(migration.version);
  }
  return executed;
}

/** Relaciona o estado de cada migração conhecida. */
export function migrationStatus(
  db: SqliteDatabase,
  migrations: readonly Migration[],
): MigrationStatus[] {
  ensureMigrationsTable(db);
  const applied = appliedVersions(db);
  return [...migrations]
    .sort((a, b) => a.version - b.version)
    .map((migration) => {
      const row = applied.get(migration.version);
      return {
        version: migration.version,
        name: migration.name,
        appliedAt: row?.applied_at ?? null,
        pending: row === undefined,
      };
    });
}

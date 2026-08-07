import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

/**
 * Abre uma conexão SQLite com WAL e chaves estrangeiras ativadas.
 *
 * Use `:memory:` para bancos efêmeros em testes.
 */
export function openDatabase(location: string): SqliteDatabase {
  if (location !== ':memory:') {
    fs.mkdirSync(path.dirname(location), { recursive: true });
  }
  const db = new Database(location);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Executa `fn` dentro de uma transação. Uma exceção reverte tudo.
 */
export function withTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  return db.transaction(fn)();
}

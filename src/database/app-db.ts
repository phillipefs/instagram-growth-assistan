import { openDatabase, type SqliteDatabase } from './connection.js';
import { runMigrations } from './migrator.js';
import { MIGRATIONS } from './migrations/index.js';
import { resolveDataPaths } from '../config/paths.js';

/**
 * Abre o banco no caminho operacional (fora do workspace) e aplica migrações.
 */
export function openAppDatabase(location?: string): SqliteDatabase {
  const target = location ?? resolveDataPaths().database;
  const db = openDatabase(target);
  runMigrations(db, MIGRATIONS);
  return db;
}

/**
 * Reseta os dados locais: remove todas as tabelas de usuário e re-migra.
 * Destinado a limpar dados de teste; exige confirmação explícita na CLI.
 */
export function resetDatabase(db: SqliteDatabase): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const { name } of tables) {
      db.exec(`DROP TABLE IF EXISTS "${name}"`);
    }
  })();
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS);
}

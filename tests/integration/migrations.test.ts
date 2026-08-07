import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/database/connection.js';
import { migrationStatus, runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';

describe('migrações', () => {
  it('aplica a migração inicial e é idempotente', () => {
    const db = openDatabase(':memory:');
    try {
      const first = runMigrations(db, MIGRATIONS);
      expect(first).toEqual([1, 2]);
      const second = runMigrations(db, MIGRATIONS);
      expect(second).toEqual([]);

      const status = migrationStatus(db, MIGRATIONS);
      expect(status[0]?.pending).toBe(false);
      expect(status[0]?.appliedAt).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it('cria as tabelas principais', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db, MIGRATIONS);
      const names = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name);
      for (const table of [
        'local_accounts',
        'profiles',
        'campaigns',
        'campaign_candidates',
        'relationships',
        'relationship_cycles',
        'action_attempts',
        'candidate_signals',
        'leases',
      ]) {
        expect(names).toContain(table);
      }
    } finally {
      db.close();
    }
  });
});

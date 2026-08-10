import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/database/connection.js';
import { migrationStatus, runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';

describe('migrações', () => {
  it('aplica a migração inicial e é idempotente', () => {
    const db = openDatabase(':memory:');
    try {
      const first = runMigrations(db, MIGRATIONS);
      expect(first).toEqual([1, 2, 3, 4, 5]);
      const second = runMigrations(db, MIGRATIONS);
      expect(second).toEqual([]);

      const status = migrationStatus(db, MIGRATIONS);
      expect(status[0]?.pending).toBe(false);
      expect(status[0]?.appliedAt).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it('preserva shortcodes históricos como posts observados ao migrar', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db, MIGRATIONS.slice(0, 3));
      const at = '2026-08-01T00:00:00.000Z';
      db.prepare(
        `INSERT INTO profiles
           (id, username_canonical, username_display, first_seen_at)
         VALUES ('target', 'alvo', 'alvo', ?), ('person', 'pessoa', 'pessoa', ?)`,
      ).run(at, at);
      db.prepare(
        `INSERT INTO campaigns
           (id, name, target_profile_id, status, created_at, updated_at)
         VALUES ('campaign', 'Campanha', 'target', 'ACTIVE', ?, ?)`,
      ).run(at, at);
      db.prepare(
        `INSERT INTO campaign_candidates
           (id, campaign_id, profile_id, state, discovery_source, discovered_at, created_at, updated_at)
         VALUES ('candidate', 'campaign', 'person', 'DISCOVERED',
                 'RECENT_POST_COMMENTERS', ?, ?, ?)`,
      ).run(at, at, at);
      db.prepare(
        `INSERT INTO candidate_signals
           (id, campaign_candidate_id, type, media_shortcode, observed_at)
         VALUES ('signal', 'candidate', 'COMMENT', 'HISTORICO', ?)`,
      ).run(at);

      expect(runMigrations(db, MIGRATIONS)).toEqual([4, 5]);
      expect(db.prepare('SELECT profile_id, shortcode, first_seen_at FROM media').get()).toEqual({
        profile_id: 'target',
        shortcode: 'HISTORICO',
        first_seen_at: at,
      });
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
        'action_reconciliations',
        'candidate_signals',
        'target_profile_observations',
        'follower_snapshots',
        'follower_snapshot_members',
        'media',
        'leases',
      ]) {
        expect(names).toContain(table);
      }
    } finally {
      db.close();
    }
  });
});

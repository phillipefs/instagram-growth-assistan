import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { FollowerSnapshotRepo } from '../../src/database/repositories/follower-snapshots.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';
import { persistFollowerSnapshot } from '../../src/workflows/sync-followers.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('snapshots de seguidores', () => {
  it('só ativa uma lista completa e materializa YES/NO nos ciclos abertos', () => {
    const account = new LocalAccountRepo(db).create({ username: 'appassetlens' });
    const profiles = new ProfileRepo(db);
    const relationships = new RelationshipRepo(db);
    const edu = profiles.upsert({ username: 'edu.brasileiro' });
    const other = profiles.upsert({ username: 'nao_segue' });
    const eduCycle = relationships.createCycle({
      relationshipId: relationships.ensure(account.id, edu.id).id,
      origin: 'TOOL_CLICK',
    });
    const otherCycle = relationships.createCycle({
      relationshipId: relationships.ensure(account.id, other.id).id,
      origin: 'TOOL_CLICK',
    });

    const incomplete = persistFollowerSnapshot(db, {
      localAccountId: account.id,
      complete: false,
      expectedCount: 2,
      loadedCount: 1,
      usernames: ['edu.brasileiro'],
      observedAt: '2026-08-10T10:00:00.000Z',
      reason: 'lista incompleta (1/2)',
    });
    const snapshots = new FollowerSnapshotRepo(db);
    expect(incomplete.snapshot.status).toBe('INCOMPLETE');
    expect(snapshots.latestComplete(account.id)).toBeUndefined();
    expect(snapshots.memberProfileIds(incomplete.snapshot.id).size).toBe(0);
    expect(relationships.findCycleById(eduCycle.id)?.followBack).toBe('UNKNOWN');

    const complete = persistFollowerSnapshot(db, {
      localAccountId: account.id,
      complete: true,
      expectedCount: 2,
      loadedCount: 2,
      usernames: ['edu.brasileiro', 'seguidor_fora_da_campanha'],
      observedAt: '2026-08-10T11:00:00.000Z',
      reason: 'lista completa carregada',
    });

    expect(complete.snapshot.status).toBe('COMPLETE');
    expect(complete.membersStored).toBe(2);
    expect(complete.relationshipCyclesUpdated).toBe(2);
    expect(snapshots.latestComplete(account.id)?.id).toBe(complete.snapshot.id);
    expect(snapshots.isMember(complete.snapshot.id, edu.id)).toBe(true);
    expect(snapshots.isMember(complete.snapshot.id, other.id)).toBe(false);
    expect(relationships.findCycleById(eduCycle.id)?.followBack).toBe('YES');
    expect(relationships.findCycleById(otherCycle.id)?.followBack).toBe('NO');
  });
});

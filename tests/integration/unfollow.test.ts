import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';
import type { ObservedRelationship } from '../../src/browser/profile-detector.js';
import type { FollowBackState, RelationshipOrigin, SafetyState } from '../../src/domain/states.js';
import { runUnfollow, type UnfollowDriver, type UnfollowItem } from '../../src/workflows/unfollow.js';
import type { Confirmer } from '../../src/workflows/follow.js';

let db: SqliteDatabase;

class FakeDriver implements UnfollowDriver {
  unfollowCalls = 0;
  constructor(
    private readonly inspectRel: ObservedRelationship,
    private readonly result: ObservedRelationship,
    private readonly safety: SafetyState = 'SAFE',
  ) {}
  inspect() {
    return Promise.resolve({ safetyState: this.safety, relationship: this.inspectRel, finalUrl: 'file://x' });
  }
  performUnfollow() {
    this.unfollowCalls += 1;
    return Promise.resolve(this.result);
  }
  screenshot() {
    return Promise.resolve(null);
  }
}

class FakeConfirmer implements Confirmer {
  constructor(
    private readonly batchOk = true,
    private readonly itemOk = true,
  ) {}
  confirmBatch() {
    return Promise.resolve(this.batchOk);
  }
  confirmItem() {
    return Promise.resolve(this.itemOk);
  }
  waitForManual() {
    return Promise.resolve();
  }
}

interface Spec {
  readonly username: string;
  readonly followBack?: FollowBackState;
  readonly whitelisted?: boolean;
  readonly isProtected?: boolean;
  readonly origin?: RelationshipOrigin;
}

function seedItems(accountId: string, specs: Spec[]): UnfollowItem[] {
  const profiles = new ProfileRepo(db);
  const rels = new RelationshipRepo(db);
  return specs.map((s) => {
    const profile = profiles.upsert({ username: s.username });
    const rel = rels.ensure(accountId, profile.id);
    if (s.whitelisted) {
      rels.setWhitelist(rel.id, true);
    }
    if (s.isProtected) {
      rels.setProtection(rel.id, true, 'teste');
    }
    const cycle = rels.createCycle({ relationshipId: rel.id, origin: s.origin ?? 'TOOL_CLICK' });
    if (s.followBack) {
      rels.setFollowBack(cycle.id, s.followBack);
    }
    return {
      profileId: profile.id,
      username: s.username,
      profileUrl: `file://${s.username}`,
      relationshipCycleId: cycle.id,
    };
  });
}

function baseOptions(accountId: string) {
  return {
    accountId,
    accountUsername: 'minha_conta',
    accountShouldStop: false,
    planFrozen: true,
    preserveFollowBacks: true,
    followBackValidityDays: 3650,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('runUnfollow', () => {
  it('dry-run apenas lista, sem ações', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('FOLLOWING', 'NOT_FOLLOWING');
    const summary = await runUnfollow(db, seedItems(account.id, [{ username: 'u1', followBack: 'NO' }]), driver, new FakeConfirmer(), {
      mode: 'dry-run',
      limit: 0,
      ...baseOptions(account.id),
    });
    expect(summary.proposedUsernames).toEqual(['u1']);
    expect(driver.unfollowCalls).toBe(0);
  });

  it('confirm-each aceito deixa de seguir e fecha o ciclo', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('FOLLOWING', 'NOT_FOLLOWING');
    const items = seedItems(account.id, [{ username: 'u1', followBack: 'NO' }]);
    const summary = await runUnfollow(db, items, driver, new FakeConfirmer(true, true), {
      mode: 'confirm-each',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.confirmed).toBe(1);
    expect(driver.unfollowCalls).toBe(1);
    const cycle = new RelationshipRepo(db).findCycleById(items[0]!.relationshipCycleId);
    expect(cycle?.unfollowedAt).not.toBeNull();
    expect(cycle?.state).toBe('UNFOLLOWED');
  });

  it('supervised-batch não confirmado não faz nada', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('FOLLOWING', 'NOT_FOLLOWING');
    const summary = await runUnfollow(db, seedItems(account.id, [{ username: 'u1', followBack: 'NO' }]), driver, new FakeConfirmer(false), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.stopped).toBe(true);
    expect(driver.unfollowCalls).toBe(0);
  });

  it('pula whitelist e protegido', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('FOLLOWING', 'NOT_FOLLOWING');
    const items = seedItems(account.id, [
      { username: 'u1', followBack: 'NO', whitelisted: true },
      { username: 'u2', followBack: 'NO', isProtected: true },
    ]);
    const summary = await runUnfollow(db, items, driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.skipped).toBe(2);
    expect(driver.unfollowCalls).toBe(0);
  });

  it('preserva quem seguiu de volta (follow_back YES)', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('FOLLOWING', 'NOT_FOLLOWING');
    const summary = await runUnfollow(db, seedItems(account.id, [{ username: 'u1', followBack: 'YES' }]), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.skipped).toBe(1);
    expect(driver.unfollowCalls).toBe(0);
  });

  it('sincroniza sem clique quando já não está seguindo', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'NOT_FOLLOWING');
    const items = seedItems(account.id, [{ username: 'u1', followBack: 'NO' }]);
    const summary = await runUnfollow(db, items, driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.synced).toBe(1);
    expect(driver.unfollowCalls).toBe(0);
    const cycle = new RelationshipRepo(db).findCycleById(items[0]!.relationshipCycleId);
    expect(cycle?.unfollowedAt).not.toBeNull();
  });

  it('fecha o lote em resultado ambíguo', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('FOLLOWING', 'FOLLOWING');
    const summary = await runUnfollow(db, seedItems(account.id, [{ username: 'u1', followBack: 'NO' }]), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.ambiguous).toBe(1);
    expect(summary.confirmed).toBe(0);
    expect(summary.stopped).toBe(true);
  });

  it('limite zero em modo real não executa nada', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('FOLLOWING', 'NOT_FOLLOWING');
    const summary = await runUnfollow(db, seedItems(account.id, [{ username: 'u1', followBack: 'NO' }]), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 0,
      ...baseOptions(account.id),
    });
    expect(summary.confirmed).toBe(0);
    expect(summary.stopped).toBe(true);
    expect(driver.unfollowCalls).toBe(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';
import { ActionAttemptRepo } from '../../src/database/repositories/actions.js';
import type { ObservedRelationship } from '../../src/browser/profile-detector.js';
import type { SafetyState } from '../../src/domain/states.js';
import {
  runFollow,
  type Confirmer,
  type FollowDriver,
  type FollowItem,
} from '../../src/workflows/follow.js';
import type { LikeAfterFollowDriver, OpenedPost } from '../../src/workflows/like.js';
import type { LikeState } from '../../src/workflows/like-result.js';

let db: SqliteDatabase;

class FakeDriver implements FollowDriver {
  followCalls = 0;
  constructor(
    private readonly inspectRel: ObservedRelationship,
    private readonly followResult: ObservedRelationship,
    private readonly safety: SafetyState = 'SAFE',
    private readonly shot: string | null = null,
    private readonly followersCount: number | null = null,
    private readonly followingCount: number | null = null,
  ) {}
  inspect() {
    return Promise.resolve({
      safetyState: this.safety,
      relationship: this.inspectRel,
      finalUrl: 'file://x',
      followersCount: this.followersCount,
      followingCount: this.followingCount,
    });
  }
  performFollow() {
    this.followCalls += 1;
    return Promise.resolve(this.followResult);
  }
  screenshot() {
    return Promise.resolve(this.shot);
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

class FakeLikeDriver implements LikeAfterFollowDriver {
  likeCalls = 0;
  constructor(
    private readonly likeResult: LikeState = 'LIKED',
    private readonly likeStateOnOpen: LikeState = 'NOT_LIKED',
  ) {}
  readRecentPosts() {
    return Promise.resolve([{ shortcode: 'POST1', positionIndex: 0 }]);
  }
  openPost(): Promise<OpenedPost> {
    return Promise.resolve({
      safetyState: 'SAFE',
      likeState: this.likeStateOnOpen,
      postUrl: 'file://p',
    });
  }
  performLike() {
    this.likeCalls += 1;
    return Promise.resolve(this.likeResult);
  }
  screenshot() {
    return Promise.resolve(null);
  }
}

function seedItems(usernames: string[]): FollowItem[] {
  const profiles = new ProfileRepo(db);
  return usernames.map((username) => {
    const profile = profiles.upsert({ username });
    return { profileId: profile.id, username, profileUrl: `file://${username}` };
  });
}

function baseOptions(accountId: string) {
  return {
    accountId,
    accountUsername: 'minha_conta',
    accountShouldStop: false,
    planFrozen: true,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('runFollow', () => {
  it('dry-run apenas lista, sem ações', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING');
    const summary = await runFollow(db, seedItems(['u1', 'u2']), driver, new FakeConfirmer(), {
      mode: 'dry-run',
      limit: 0,
      ...baseOptions(account.id),
    });
    expect(summary.proposedUsernames).toEqual(['u1', 'u2']);
    expect(driver.followCalls).toBe(0);
  });

  it('confirm-each aceito segue e registra ciclo TOOL_CLICK', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING');
    const items = seedItems(['u1']);
    const summary = await runFollow(db, items, driver, new FakeConfirmer(true, true), {
      mode: 'confirm-each',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.confirmed).toBe(1);
    const rel = new RelationshipRepo(db).ensure(account.id, items[0]!.profileId);
    const cycle = new RelationshipRepo(db).getOpenCycle(rel.id);
    expect(cycle?.origin).toBe('TOOL_CLICK');
    expect(cycle?.followedByTool).toBe(true);
  });

  it('confirm-each recusado não segue', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING');
    const summary = await runFollow(db, seedItems(['u1']), driver, new FakeConfirmer(true, false), {
      mode: 'confirm-each',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.confirmed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(driver.followCalls).toBe(0);
  });

  it('supervised-batch não confirmado não faz nada', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING');
    const summary = await runFollow(db, seedItems(['u1', 'u2']), driver, new FakeConfirmer(false), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.stopped).toBe(true);
    expect(summary.stopReason).toMatch(/não confirmado/);
    expect(driver.followCalls).toBe(0);
  });

  it('pula quem já é seguido (guarda)', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('FOLLOWING', 'FOLLOWING');
    const summary = await runFollow(db, seedItems(['u1', 'u2']), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.skipped).toBe(2);
    expect(driver.followCalls).toBe(0);
  });

  it('fecha o lote em resultado ambíguo', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'NOT_FOLLOWING');
    const summary = await runFollow(db, seedItems(['u1', 'u2']), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
    });
    expect(summary.ambiguous).toBe(1);
    expect(summary.confirmed).toBe(0);
    expect(summary.stopped).toBe(true);
  });

  it('captura evidência (screenshot) no resultado ambíguo', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver(
      'NOT_FOLLOWING',
      'NOT_FOLLOWING',
      'SAFE',
      '/evidence/follow-ambiguous.png',
    );
    const items = seedItems(['u1']);
    await runFollow(db, items, driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
    });
    const attempts = new ActionAttemptRepo(db).listByProfileId(items[0]!.profileId);
    expect(attempts[0]?.state).toBe('AMBIGUOUS');
    expect(attempts[0]?.screenshotPath).toBe('/evidence/follow-ambiguous.png');
  });

  it('limite zero em modo real não executa nada', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING');
    const summary = await runFollow(db, seedItems(['u1']), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 0,
      ...baseOptions(account.id),
    });
    expect(summary.confirmed).toBe(0);
    expect(summary.stopped).toBe(true);
    expect(driver.followCalls).toBe(0);
  });

  it('pula perfil abaixo do mínimo de seguidores', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING', 'SAFE', null, 2, 0);
    const summary = await runFollow(db, seedItems(['u1']), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
      skipInactiveBelow: 20,
    });
    expect(summary.confirmed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(driver.followCalls).toBe(0);
  });

  it('segue perfil ativo mesmo com skipInactiveBelow', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING', 'SAFE', null, 500, 100);
    const summary = await runFollow(db, seedItems(['u1']), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
      skipInactiveBelow: 20,
    });
    expect(summary.confirmed).toBe(1);
  });

  it('não clica quando a quantidade de seguidores é desconhecida', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING', 'SAFE', null, null, 0);
    const summary = await runFollow(db, seedItems(['u1']), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
      skipInactiveBelow: 20,
    });
    expect(summary.confirmed).toBe(0);
    expect(summary.review).toBe(1);
    expect(summary.stopped).toBe(false);
    expect(driver.followCalls).toBe(0);
  });

  it('segue quando há seguidores suficientes, independentemente de quantos está seguindo', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING', 'SAFE', null, 50, 0);
    const summary = await runFollow(db, seedItems(['u1']), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
      skipInactiveBelow: 50,
    });
    expect(summary.confirmed).toBe(1);
    expect(driver.followCalls).toBe(1);
  });

  it('likeAfterFollow curte a publicação recente ao seguir perfil aberto', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOWING');
    const likeDriver = new FakeLikeDriver('LIKED');
    const items = seedItems(['u1']);
    const summary = await runFollow(db, items, driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
      likeAfterFollow: true,
      likeMaxAgeDays: 30,
      likeDriver,
    });
    expect(summary.confirmed).toBe(1);
    expect(summary.liked).toBe(1);
    expect(likeDriver.likeCalls).toBe(1);
    const like = new ActionAttemptRepo(db)
      .listByProfileId(items[0]!.profileId)
      .find((a) => a.actionType === 'LIKE_POST');
    expect(like?.state).toBe('CONFIRMED');
  });

  it('likeAfterFollow NÃO curte quando vira solicitação (perfil fechado)', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeDriver('NOT_FOLLOWING', 'FOLLOW_REQUESTED');
    const likeDriver = new FakeLikeDriver('LIKED');
    const summary = await runFollow(db, seedItems(['u1']), driver, new FakeConfirmer(), {
      mode: 'supervised-batch',
      limit: 5,
      ...baseOptions(account.id),
      likeAfterFollow: true,
      likeMaxAgeDays: 30,
      likeDriver,
    });
    expect(summary.confirmed).toBe(1);
    expect(summary.liked).toBe(0);
    expect(likeDriver.likeCalls).toBe(0);
  });
});

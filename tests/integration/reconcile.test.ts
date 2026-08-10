import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';
import type { SafetyState } from '../../src/domain/states.js';
import type { ProfileType } from '../../src/browser/profile-detector.js';
import {
  loadOpenCyclesForAccount,
  runReconcile,
  type FollowBackDriver,
  type FollowBackInspection,
} from '../../src/workflows/reconcile-followback.js';

let db: SqliteDatabase;

class FakeDriver implements FollowBackDriver {
  constructor(
    private readonly opts: {
      byUser?: Record<string, boolean>;
      confirmedAbsence?: boolean;
      safetyState?: SafetyState;
    } = {},
  ) {}
  inspect(profileUrl: string): Promise<FollowBackInspection> {
    const user = profileUrl.replace(/\/$/, '').split('/').pop() ?? '';
    return Promise.resolve({
      safetyState: this.opts.safetyState ?? 'SAFE',
      profileType: 'PUBLIC' as ProfileType,
      followsYou: this.opts.byUser?.[user] ?? false,
      notFollowingConfirmed: this.opts.confirmedAbsence === true,
    });
  }
}

function setup() {
  const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
  const profiles = new ProfileRepo(db);
  const relationships = new RelationshipRepo(db);
  const make = (username: string) => {
    const profile = profiles.upsert({ username });
    const rel = relationships.ensure(account.id, profile.id);
    const cycle = relationships.createCycle({
      relationshipId: rel.id,
      origin: 'TOOL_CLICK',
      state: 'FOLLOWING',
    });
    return { profile, rel, cycle };
  };
  return { account, relationships, make };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('loadOpenCyclesForAccount', () => {
  it('retorna apenas ciclos abertos ainda não inspecionados', () => {
    const { account, relationships, make } = setup();
    const inspected = make('inspecionado');
    relationships.setFollowBack(inspected.cycle.id, 'UNKNOWN');
    const pending = make('pendente');
    const closed = make('fechado');
    relationships.closeCycle(closed.cycle.id, { unfollowReason: 'teste' });

    const items = loadOpenCyclesForAccount(db, account.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.username).toBe(pending.profile.usernameDisplay);
  });
});

describe('runReconcile', () => {
  it('salva YES e mantém UNKNOWN quando não há confirmação positiva', async () => {
    const { account, relationships, make } = setup();
    const a = make('u1');
    const b = make('u2');

    const driver = new FakeDriver({ byUser: { u1: true, u2: false } });
    const items = loadOpenCyclesForAccount(db, account.id);
    const summary = await runReconcile(db, items, driver, { limit: 10, accountShouldStop: false });

    expect(summary.yes).toBe(1);
    expect(summary.no).toBe(0);
    expect(summary.unknown).toBe(1);
    expect(relationships.findCycleById(a.cycle.id)?.followBack).toBe('YES');
    expect(relationships.findCycleById(b.cycle.id)?.followBack).toBe('UNKNOWN');
    expect(loadOpenCyclesForAccount(db, account.id)).toHaveLength(0);
  });

  it('para sob estado de segurança bloqueante', async () => {
    const { account, make } = setup();
    make('u1');
    const driver = new FakeDriver({ safetyState: 'CAPTCHA_DETECTED' });
    const items = loadOpenCyclesForAccount(db, account.id);
    const summary = await runReconcile(db, items, driver, { limit: 10, accountShouldStop: false });
    expect(summary.stopped).toBe(true);
    expect(summary.processed).toBe(0);
  });

  it('salva NO quando a lista completa confirma a ausência', async () => {
    const { account, relationships, make } = setup();
    const item = make('nao_segue');
    const driver = new FakeDriver({ confirmedAbsence: true });

    const summary = await runReconcile(db, loadOpenCyclesForAccount(db, account.id), driver, {
      limit: 10,
      accountShouldStop: false,
    });

    expect(summary.no).toBe(1);
    expect(relationships.findCycleById(item.cycle.id)?.followBack).toBe('NO');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';
import { PlanRepo } from '../../src/database/repositories/plans.js';
import type { FollowBackState, RelationshipOrigin } from '../../src/domain/states.js';
import { computeUnfollowWindow } from '../../src/domain/cohort.js';
import {
  buildUnfollowPreview,
  freezeUnfollowPlan,
  loadUnfollowCohort,
} from '../../src/workflows/plan-unfollow.js';

let db: SqliteDatabase;
let accountId: string;
const now = new Date('2026-08-06T12:00:00.000Z');

function make(
  username: string,
  opts: {
    origin?: RelationshipOrigin;
    followedAt?: string;
    whitelisted?: boolean;
    protected?: boolean;
    followBack?: FollowBackState;
  } = {},
) {
  const profile = new ProfileRepo(db).upsert({ username });
  const relationships = new RelationshipRepo(db);
  const rel = relationships.ensure(accountId, profile.id);
  if (opts.whitelisted) relationships.setWhitelist(rel.id, true);
  if (opts.protected) relationships.setProtection(rel.id, true, 'teste');
  const cycle = relationships.createCycle({
    relationshipId: rel.id,
    origin: opts.origin ?? 'TOOL_CLICK',
    state: 'FOLLOWING',
    followedAt: opts.followedAt ?? '2026-07-10T00:00:00.000Z',
  });
  if (opts.followBack) {
    // Carimbo determinístico para o teste de frescor (dentro da validade e <= now).
    db.prepare('UPDATE relationship_cycles SET follow_back = ?, follow_back_checked_at = ? WHERE id = ?').run(
      opts.followBack,
      '2026-07-15T00:00:00.000Z',
      cycle.id,
    );
  }
  return cycle;
}

const previewOptions = { preserveFollowBacks: true, followBackValidityDays: 3650, now };

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
  accountId = new LocalAccountRepo(db).create({ username: 'minha_conta' }).id;
});

describe('planejador de unfollow', () => {
  it('aplica a regra base e conta exclusões', () => {
    make('elegivel', { followBack: 'NO' });
    make('na_whitelist', { whitelisted: true, followBack: 'NO' });
    make('protegido', { protected: true, followBack: 'NO' });
    make('manual', { origin: 'USER_CLICK_OBSERVED', followBack: 'NO' });
    make('segue_de_volta', { followBack: 'YES' });
    make('desconhecido', { followBack: 'UNKNOWN' });
    make('fora_da_janela', { followBack: 'NO', followedAt: '2026-06-01T00:00:00.000Z' });

    const window = computeUnfollowWindow({ calendarMonth: '2026-07' }, now);
    const candidates = loadUnfollowCohort(db, { localAccountId: accountId, window });
    expect(candidates).toHaveLength(6); // fora_da_janela é filtrado no SQL

    const preview = buildUnfollowPreview(candidates, previewOptions);
    expect(preview.excluded.no_tool_history).toBe(1);
    expect(preview.excluded.whitelisted).toBe(1);
    expect(preview.excluded.protected).toBe(1);
    expect(preview.excluded.follow_back_not_no).toBe(2);
    expect(preview.totalEligible).toBe(1);
    expect(preview.proposed.map((p) => p.username)).toEqual(['elegivel']);
  });

  it('exclui quem seguiu de volta com --exclude-followers', () => {
    make('nao_segue', { followBack: 'NO' });
    make('segue', { followBack: 'YES' });
    const window = computeUnfollowWindow({ calendarMonth: '2026-07' }, now);
    const candidates = loadUnfollowCohort(db, { localAccountId: accountId, window });
    const preview = buildUnfollowPreview(candidates, { ...previewOptions, excludeFollowers: true });
    expect(preview.excluded.follower).toBe(1);
    expect(preview.totalEligible).toBe(1);
  });

  it('congela um plano de unfollow imutável', () => {
    make('elegivel', { followBack: 'NO' });
    make('protegido', { protected: true, followBack: 'NO' });

    const result = freezeUnfollowPlan(db, {
      localAccountId: accountId,
      filters: { calendarMonth: '2026-07' },
      preserveFollowBacks: true,
      followBackValidityDays: 3650,
      now,
    });
    expect(result.plan.state).toBe('FROZEN');
    expect(result.plan.type).toBe('UNFOLLOW');
    expect(result.itemCount).toBe(1);

    const items = new PlanRepo(db).listItems(result.plan.id);
    expect(items[0]?.relationshipCycleId).not.toBeNull();
  });
});

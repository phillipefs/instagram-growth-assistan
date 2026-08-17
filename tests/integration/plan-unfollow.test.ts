import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';
import { PlanRepo } from '../../src/database/repositories/plans.js';
import { ActionAttemptRepo } from '../../src/database/repositories/actions.js';
import type {
  FollowBackState,
  RelationshipOrigin,
  RelationshipState,
} from '../../src/domain/states.js';
import { computeUnfollowWindow } from '../../src/domain/cohort.js';
import {
  buildUnfollowPreview,
  freezeUnfollowPlan,
  loadUnfollowCohort,
  resolveUnfollowPlanPolicy,
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
    followBackCheckedAt?: string;
    relationshipState?: RelationshipState;
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
    state: opts.relationshipState ?? 'FOLLOWING',
    followedAt: opts.followedAt ?? '2026-07-10T00:00:00.000Z',
  });
  if (opts.followBack) {
    // Carimbo determinístico para o teste de frescor (dentro da validade e <= now).
    db.prepare(
      'UPDATE relationship_cycles SET follow_back = ?, follow_back_checked_at = ? WHERE id = ?',
    ).run(opts.followBack, opts.followBackCheckedAt ?? '2026-07-15T00:00:00.000Z', cycle.id);
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

  it('só inclui NO observado após o prazo de --no-follow-back-after', () => {
    make('elegivel', {
      followedAt: '2026-07-20T00:00:00.000Z',
      followBack: 'NO',
      followBackCheckedAt: '2026-07-27T00:00:00.000Z',
    });
    make('checado_cedo', {
      followedAt: '2026-07-20T00:00:00.000Z',
      followBack: 'NO',
      followBackCheckedAt: '2026-07-25T00:00:00.000Z',
    });
    make('seguiu_de_volta', {
      followedAt: '2026-07-20T00:00:00.000Z',
      followBack: 'YES',
      followBackCheckedAt: '2026-07-27T00:00:00.000Z',
    });
    make('ainda_no_prazo', {
      followedAt: '2026-08-01T00:00:00.000Z',
      followBack: 'NO',
      followBackCheckedAt: '2026-08-06T00:00:00.000Z',
    });

    const filters = { noFollowBackAfterDays: 7 };
    const window = computeUnfollowWindow(filters, now);
    const candidates = loadUnfollowCohort(db, { localAccountId: accountId, window });
    const preview = buildUnfollowPreview(candidates, {
      ...previewOptions,
      excludeFollowers: true,
      noFollowBackAfterDays: 7,
    });

    expect(candidates.map((candidate) => candidate.username)).not.toContain('ainda_no_prazo');
    expect(preview.proposed.map((candidate) => candidate.username)).toEqual(['elegivel']);
    expect(preview.excluded.follower).toBe(1);
    expect(preview.excluded.follow_back_wait_not_met).toBe(1);

    expect(() =>
      freezeUnfollowPlan(db, {
        localAccountId: accountId,
        filters,
        preserveFollowBacks: false,
        followBackValidityDays: 3650,
        now,
      }),
    ).toThrow('snapshot completo');

    const frozen = freezeUnfollowPlan(db, {
      localAccountId: accountId,
      filters,
      preserveFollowBacks: false,
      followBackValidityDays: 3650,
      followerSnapshotId: 'snapshot-recente',
      followerSnapshotObservedAt: '2026-08-06T00:00:00.000Z',
      now,
    });
    expect(frozen.itemCount).toBe(1);
    expect(JSON.parse(frozen.plan.criteriaJson)).toMatchObject({
      filters: { noFollowBackAfterDays: 7 },
      policy: {
        preserveFollowBacks: true,
        noFollowBackAfterDays: 7,
      },
      usernames: ['elegivel'],
    });
  });

  it('exclui qualquer tentativa anterior com --only-unattempted', () => {
    make('tentado', { followBack: 'NO' });
    make('inedito', { followBack: 'NO' });
    const attempted = new ProfileRepo(db).findByUsername('tentado');
    expect(attempted).toBeDefined();
    new ActionAttemptRepo(db).prepare({
      localAccountId: accountId,
      profileId: attempted!.id,
      actionType: 'UNFOLLOW',
      idempotencyKey: 'unfollow-anterior',
    });

    const window = computeUnfollowWindow({ calendarMonth: '2026-07' }, now);
    const candidates = loadUnfollowCohort(db, { localAccountId: accountId, window });
    const preview = buildUnfollowPreview(candidates, {
      ...previewOptions,
      onlyUnattempted: true,
    });
    expect(preview.excluded.previously_attempted).toBe(1);
    expect(preview.proposed.map((item) => item.username)).toEqual(['inedito']);
  });

  it('congela um plano de unfollow imutável', () => {
    make('elegivel', { followBack: 'NO' });
    make('protegido', { protected: true, followBack: 'NO' });

    const result = freezeUnfollowPlan(db, {
      localAccountId: accountId,
      filters: { calendarMonth: '2026-07' },
      preserveFollowBacks: true,
      followBackValidityDays: 3650,
      followerSnapshotId: 'snapshot-test',
      followerSnapshotObservedAt: '2026-08-06T11:00:00.000Z',
      now,
    });
    expect(result.plan.state).toBe('FROZEN');
    expect(result.plan.type).toBe('UNFOLLOW');
    expect(result.itemCount).toBe(1);
    expect(
      resolveUnfollowPlanPolicy(result.plan.criteriaJson, {
        preserveFollowBacks: false,
        followBackValidityDays: 7,
      }),
    ).toEqual({ preserveFollowBacks: true, followBackValidityDays: 3650 });
    expect(JSON.parse(result.plan.criteriaJson)).toMatchObject({
      policy: {
        followerSnapshotId: 'snapshot-test',
        followerSnapshotObservedAt: '2026-08-06T11:00:00.000Z',
      },
    });

    const items = new PlanRepo(db).listItems(result.plan.id);
    expect(items[0]?.relationshipCycleId).not.toBeNull();
  });

  it('prioriza FOLLOWING antes de FOLLOW_REQUESTED no plano de unfollow', () => {
    make('solicitado_antigo', {
      relationshipState: 'FOLLOW_REQUESTED',
      followedAt: '2026-07-10T00:00:00.000Z',
      followBack: 'NO',
      followBackCheckedAt: '2026-07-20T00:00:00.000Z',
    });
    make('seguindo_recente', {
      relationshipState: 'FOLLOWING',
      followedAt: '2026-07-25T00:00:00.000Z',
      followBack: 'NO',
      followBackCheckedAt: '2026-07-30T00:00:00.000Z',
    });
    make('seguindo_antigo', {
      relationshipState: 'FOLLOWING',
      followedAt: '2026-07-20T00:00:00.000Z',
      followBack: 'NO',
      followBackCheckedAt: '2026-07-25T00:00:00.000Z',
    });

    const result = freezeUnfollowPlan(db, {
      localAccountId: accountId,
      filters: { noFollowBackAfterDays: 3 },
      preserveFollowBacks: true,
      followBackValidityDays: 3650,
      followerSnapshotId: 'snapshot-test',
      followerSnapshotObservedAt: '2026-08-06T11:00:00.000Z',
      now,
    });

    expect(result.itemCount).toBe(3);
    expect(JSON.parse(result.plan.criteriaJson).usernames).toEqual([
      'seguindo_antigo',
      'seguindo_recente',
      'solicitado_antigo',
    ]);
  });
});

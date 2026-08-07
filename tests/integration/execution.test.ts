import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { CampaignRepo, CampaignCandidateRepo } from '../../src/database/repositories/campaigns.js';
import { CandidateSignalRepo } from '../../src/database/repositories/candidate-signals.js';
import { ActionAttemptRepo } from '../../src/database/repositories/actions.js';
import { PlanRepo, InvalidPlanStateError } from '../../src/database/repositories/plans.js';
import { RunRepo } from '../../src/database/repositories/runs.js';
import { ingestDiscovered } from '../../src/workflows/collect.js';
import { freezeFollowPlan } from '../../src/workflows/plan-follow.js';
import { runActionBatch, type BatchItem } from '../../src/workflows/execution.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('PlanRepo — imutabilidade', () => {
  it('cria DRAFT, congela e impede novos itens', () => {
    const profiles = new ProfileRepo(db);
    const plans = new PlanRepo(db);
    const p = plans.create({ type: 'FOLLOW', criteria: { a: 1 }, config: {} });
    expect(p.state).toBe('DRAFT');

    const profile = profiles.upsert({ username: 'x' });
    plans.addItem({ planId: p.id, profileId: profile.id, position: 0 });

    const frozen = plans.freeze(p.id);
    expect(frozen.state).toBe('FROZEN');
    expect(frozen.frozenAt).not.toBeNull();

    expect(() => plans.addItem({ planId: p.id, profileId: profile.id, position: 1 })).toThrow(
      InvalidPlanStateError,
    );
    expect(() => plans.freeze(p.id)).toThrow(InvalidPlanStateError);
  });

  it('gera o mesmo criteria_hash independente da ordem das chaves', () => {
    const plans = new PlanRepo(db);
    const a = plans.create({ type: 'FOLLOW', criteria: { x: 1, y: 2 }, config: {} });
    const b = plans.create({ type: 'FOLLOW', criteria: { y: 2, x: 1 }, config: {} });
    expect(a.criteriaHash).toBe(b.criteriaHash);
  });
});

describe('RunRepo — ciclo de vida', () => {
  it('cria, inicia e finaliza', () => {
    const runs = new RunRepo(db);
    const run = runs.create({ type: 'FOLLOW', mode: 'supervised-batch' });
    expect(run.status).toBe('CREATED');
    expect(runs.start(run.id).status).toBe('RUNNING');
    const done = runs.finish(run.id, 'COMPLETED');
    expect(done.status).toBe('COMPLETED');
    expect(done.endedAt).not.toBeNull();
  });
});

describe('PlanRepo.progress', () => {
  it('agrega itens por estado da tentativa, tratando ausência como pendente', () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const profiles = new ProfileRepo(db);
    const plans = new PlanRepo(db);
    const actions = new ActionAttemptRepo(db);

    const plan = plans.create({ type: 'FOLLOW', criteria: {}, config: {} });
    const items = ['a', 'b', 'c', 'd', 'e'].map((u, i) => {
      const profile = profiles.upsert({ username: u });
      return plans.addItem({ planId: plan.id, profileId: profile.id, position: i });
    });
    plans.freeze(plan.id);

    const attempt = (planItemId: string, profileId: string) =>
      actions.prepare({
        localAccountId: account.id,
        profileId,
        actionType: 'FOLLOW',
        idempotencyKey: `k-${planItemId}`,
        planItemId,
      }).attempt.id;

    // a → CONFIRMED, b → SKIPPED, c → AMBIGUOUS, d → FAILED, e → sem tentativa (pendente)
    const a = attempt(items[0]!.id, items[0]!.profileId);
    actions.transition(a, 'PENDING');
    actions.transition(a, 'CONFIRMED');

    const b = attempt(items[1]!.id, items[1]!.profileId);
    actions.transition(b, 'SKIPPED');

    const c = attempt(items[2]!.id, items[2]!.profileId);
    actions.transition(c, 'PENDING');
    actions.transition(c, 'AMBIGUOUS');

    const d = attempt(items[3]!.id, items[3]!.profileId);
    actions.transition(d, 'FAILED');

    const progress = plans.progress(plan.id);
    expect(progress).toEqual({
      total: 5,
      pending: 1,
      confirmed: 1,
      skipped: 1,
      ambiguous: 1,
      failed: 1,
      percentDone: 80,
    });

    actions.reconcileAmbiguousAsSkipped(c, 'skip manual');
    expect(plans.progress(plan.id)).toEqual({
      total: 5,
      pending: 1,
      confirmed: 1,
      skipped: 2,
      ambiguous: 0,
      failed: 1,
      percentDone: 80,
    });
  });

  it('retorna zeros para um plano sem itens', () => {
    const plans = new PlanRepo(db);
    const plan = plans.create({ type: 'FOLLOW', criteria: {}, config: {} });
    expect(plans.progress(plan.id)).toEqual({
      total: 0,
      pending: 0,
      confirmed: 0,
      skipped: 0,
      ambiguous: 0,
      failed: 0,
      percentDone: 0,
    });
  });
});

describe('freezeFollowPlan', () => {
  it('congela plano ordenado por engajamento', () => {
    const campaign = new CampaignRepo(db).create({ name: 'C' });
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    ingestDiscovered(
      {
        profiles: new ProfileRepo(db),
        candidates: new CampaignCandidateRepo(db),
        signals: new CandidateSignalRepo(db),
      },
      campaign.id,
      [
        {
          username: 'invest_a',
          source: 'RECENT_POST_COMMENTERS',
          signal: { type: 'COMMENT', mediaShortcode: 'A' },
        },
        {
          username: 'invest_a',
          source: 'RECENT_POST_LIKERS',
          signal: { type: 'LIKE', mediaShortcode: 'A' },
        },
        {
          username: 'trader_b',
          source: 'RECENT_POST_COMMENTERS',
          signal: { type: 'COMMENT', mediaShortcode: 'A' },
        },
      ],
    );

    const result = freezeFollowPlan(db, { campaignId: campaign.id, localAccountId: account.id });
    expect(result.plan.state).toBe('FROZEN');
    expect(result.itemCount).toBe(2);

    const items = new PlanRepo(db).listItems(result.plan.id);
    const firstSnapshot = JSON.parse(items[0]?.snapshotJson ?? '{}') as { username: string };
    expect(firstSnapshot.username).toBe('invest_a');
  });
});

describe('runActionBatch', () => {
  function seedItems(usernames: string[]): BatchItem[] {
    const profiles = new ProfileRepo(db);
    return usernames.map((username) => {
      const profile = profiles.upsert({ username });
      return { profileId: profile.id, targetEntityId: username };
    });
  }

  const proceedAndConfirm = {
    evaluate: () => ({ outcome: 'PROCEED' as const, reason: '' }),
    execute: () => Promise.resolve({ result: 'CONFIRMED' as const }),
  };

  it('confirma todos e é idempotente ao reexecutar', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const actions = new ActionAttemptRepo(db);
    const items = seedItems(['u1', 'u2']);
    const config = {
      localAccountId: account.id,
      localAccountUsername: 'minha_conta',
      actionType: 'FOLLOW' as const,
      limit: 10,
    };

    const first = await runActionBatch(actions, items, config, proceedAndConfirm);
    expect(first.confirmed).toBe(2);
    expect(first.stopped).toBe(false);

    const second = await runActionBatch(actions, items, config, proceedAndConfirm);
    expect(second.idempotentSkips).toBe(2);
    expect(second.confirmed).toBe(0);
  });

  it('não executa nada com limite zero (dry-run)', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'c' });
    const actions = new ActionAttemptRepo(db);
    const summary = await runActionBatch(
      actions,
      seedItems(['u1']),
      {
        localAccountId: account.id,
        localAccountUsername: 'c',
        actionType: 'FOLLOW',
        limit: 0,
      },
      proceedAndConfirm,
    );
    expect(summary.proceeded).toBe(0);
    expect(summary.stopped).toBe(true);
    expect(summary.stopReason).toMatch(/limite/);
  });

  it('fecha o lote em resultado ambíguo', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'c' });
    const actions = new ActionAttemptRepo(db);
    const summary = await runActionBatch(
      actions,
      seedItems(['u1', 'u2']),
      {
        localAccountId: account.id,
        localAccountUsername: 'c',
        actionType: 'FOLLOW',
        limit: 10,
      },
      {
        evaluate: () => ({ outcome: 'PROCEED', reason: '' }),
        execute: () => Promise.resolve({ result: 'AMBIGUOUS' }),
      },
    );
    expect(summary.ambiguous).toBe(1);
    expect(summary.confirmed).toBe(0);
    expect(summary.stopped).toBe(true);
  });

  it('retoma depois de skip explícito sem repetir a ação ambígua', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'c' });
    const actions = new ActionAttemptRepo(db);
    const items = seedItems(['u1', 'u2']);
    const config = {
      localAccountId: account.id,
      localAccountUsername: 'c',
      actionType: 'FOLLOW' as const,
      limit: 10,
    };
    let executions = 0;
    const hooks = {
      evaluate: () => ({ outcome: 'PROCEED' as const, reason: '' }),
      execute: () => {
        executions += 1;
        return Promise.resolve({
          result: (executions === 1 ? 'AMBIGUOUS' : 'CONFIRMED') as 'AMBIGUOUS' | 'CONFIRMED',
        });
      },
    };

    const first = await runActionBatch(actions, items, config, hooks);
    expect(first.ambiguous).toBe(1);
    const ambiguous = actions.listByProfileId(items[0]!.profileId)[0]!;
    actions.reconcileAmbiguousAsSkipped(ambiguous.id, 'skip manual');

    const resumed = await runActionBatch(actions, items, config, hooks);
    expect(resumed.stopped).toBe(false);
    expect(resumed.skipped).toBe(1);
    expect(resumed.confirmed).toBe(1);
    expect(executions).toBe(2);
  });

  it('pula itens marcados como SKIP e continua', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'c' });
    const actions = new ActionAttemptRepo(db);
    const summary = await runActionBatch(
      actions,
      seedItems(['u1', 'u2']),
      {
        localAccountId: account.id,
        localAccountUsername: 'c',
        actionType: 'FOLLOW',
        limit: 10,
      },
      {
        evaluate: () => ({ outcome: 'SKIP', reason: 'já seguindo' }),
        execute: () => Promise.resolve({ result: 'CONFIRMED' }),
      },
    );
    expect(summary.skipped).toBe(2);
    expect(summary.confirmed).toBe(0);
    expect(summary.stopped).toBe(false);
  });

  it('emite progresso por item via onProgress', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'c' });
    const actions = new ActionAttemptRepo(db);
    const events: { target: string; outcome: string; processed: number; total: number }[] = [];
    await runActionBatch(
      actions,
      seedItems(['u1', 'u2', 'u3']),
      {
        localAccountId: account.id,
        localAccountUsername: 'c',
        actionType: 'FOLLOW',
        limit: 10,
        onProgress: (p) =>
          events.push({
            target: p.targetEntityId,
            outcome: p.outcome,
            processed: p.processed,
            total: p.total,
          }),
      },
      proceedAndConfirm,
    );
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.outcome === 'CONFIRMED')).toBe(true);
    expect(events.every((e) => e.total === 3)).toBe(true);
    expect(events.map((e) => e.processed)).toEqual([1, 2, 3]);
    expect(events.map((e) => e.target)).toEqual(['u1', 'u2', 'u3']);
  });
});

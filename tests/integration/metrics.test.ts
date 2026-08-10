import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { CampaignRepo, CampaignCandidateRepo } from '../../src/database/repositories/campaigns.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';
import { ActionAttemptRepo } from '../../src/database/repositories/actions.js';
import { RunRepo } from '../../src/database/repositories/runs.js';
import type { ActionState } from '../../src/domain/states.js';
import { computeMetrics, formatMetrics } from '../../src/workflows/metrics.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

function confirmFollow(
  actions: ActionAttemptRepo,
  accountId: string,
  profileId: string,
  key: string,
  finalState: ActionState,
): void {
  const { attempt } = actions.prepare({
    localAccountId: accountId,
    profileId,
    actionType: 'FOLLOW',
    idempotencyKey: key,
  });
  actions.transition(attempt.id, 'PENDING');
  actions.transition(attempt.id, finalState);
}

describe('computeMetrics', () => {
  it('agrega coleta, execuções, ações e ciclos', () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const profiles = new ProfileRepo(db);
    const campaign = new CampaignRepo(db).create({ name: 'C1' });
    const candidates = new CampaignCandidateRepo(db);
    const p1 = profiles.upsert({ username: 'a' });
    const p2 = profiles.upsert({ username: 'b' });
    const p3 = profiles.upsert({ username: 'c' });
    candidates.add({
      campaignId: campaign.id,
      profileId: p1.id,
      discoverySource: 'RECENT_POST_COMMENTERS',
    });
    candidates.add({
      campaignId: campaign.id,
      profileId: p2.id,
      discoverySource: 'RECENT_POST_LIKERS',
    });
    candidates.add({ campaignId: campaign.id, profileId: p3.id, discoverySource: 'FOLLOWERS' });

    new RunRepo(db).create({ type: 'FOLLOW', mode: 'supervised-batch' });

    const actions = new ActionAttemptRepo(db);
    confirmFollow(actions, account.id, p1.id, 'k1', 'CONFIRMED');
    confirmFollow(actions, account.id, p2.id, 'k2', 'CONFIRMED');
    confirmFollow(actions, account.id, p3.id, 'k3', 'AMBIGUOUS');

    const rel = new RelationshipRepo(db);
    const r1 = rel.ensure(account.id, p1.id);
    const c1 = rel.createCycle({
      relationshipId: r1.id,
      origin: 'TOOL_CLICK',
      campaignId: campaign.id,
    });
    rel.setFollowBack(c1.id, 'YES');
    const r2 = rel.ensure(account.id, p2.id);
    const c2 = rel.createCycle({
      relationshipId: r2.id,
      origin: 'TOOL_CLICK',
      campaignId: campaign.id,
    });
    rel.closeCycle(c2.id, { unfollowReason: 'teste' });
    const r3 = rel.ensure(account.id, p3.id);
    rel.createCycle({
      relationshipId: r3.id,
      origin: 'TOOL_CLICK',
      state: 'FOLLOW_REQUESTED',
      campaignId: campaign.id,
    });

    const metrics = computeMetrics(db);

    expect(metrics.campaigns).toHaveLength(1);
    expect(metrics.campaigns[0]?.candidates).toBe(3);
    expect(metrics.campaigns[0]?.bySource).toEqual({
      RECENT_POST_COMMENTERS: 1,
      RECENT_POST_LIKERS: 1,
      FOLLOWERS: 1,
    });

    expect(metrics.runsByType).toEqual({ FOLLOW: 1 });

    const follow = metrics.actions.find((a) => a.actionType === 'FOLLOW');
    expect(follow?.confirmed).toBe(2);
    expect(follow?.ambiguous).toBe(1);

    const toolClick = metrics.cyclesByOrigin.find((c) => c.origin === 'TOOL_CLICK');
    expect(toolClick).toEqual({ origin: 'TOOL_CLICK', open: 2, closed: 1 });

    // Aberto: c1 (FOLLOWING) e c3 (FOLLOW_REQUESTED); c2 foi fechado.
    expect(metrics.openFollowsByState.FOLLOWING).toBe(1);
    expect(metrics.openFollowsByState.FOLLOW_REQUESTED).toBe(1);

    // Quebra histórica por campanha: o ciclo fechado continua visível.
    const c1Follows = metrics.followsByCampaign.find((c) => c.name === 'C1');
    expect(c1Follows).toEqual({
      name: 'C1',
      following: 1,
      requested: 1,
      unfollowed: 1,
      open: 2,
      total: 3,
    });

    expect(metrics.followBack.YES).toBe(1);
    expect(metrics.followBack.UNKNOWN).toBe(2);
  });

  it('renderiza texto legível mesmo sem dados', () => {
    const text = formatMetrics(computeMetrics(db));
    expect(text).toContain('Métricas do experimento');
    expect(text).toContain('(nenhuma campanha com candidatos)');
    expect(text).toContain('(nenhuma execução)');
    expect(text).toContain('Follows abertos por estado:');
  });

  it('mantém a campanha nas métricas quando todos os follows foram encerrados', () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const campaign = new CampaignRepo(db).create({ name: 'Finalizada' });
    const profile = new ProfileRepo(db).upsert({ username: 'removido' });
    const relationships = new RelationshipRepo(db);
    const relationship = relationships.ensure(account.id, profile.id);
    const cycle = relationships.createCycle({
      relationshipId: relationship.id,
      origin: 'TOOL_CLICK',
      campaignId: campaign.id,
    });
    relationships.closeCycle(cycle.id, { unfollowReason: 'fim da campanha' });

    expect(computeMetrics(db).followsByCampaign).toContainEqual({
      name: 'Finalizada',
      following: 0,
      requested: 0,
      unfollowed: 1,
      open: 0,
      total: 1,
    });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { CampaignCandidateRepo, CampaignRepo } from '../../src/database/repositories/campaigns.js';
import { CandidateSignalRepo } from '../../src/database/repositories/candidate-signals.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';
import { ActionAttemptRepo } from '../../src/database/repositories/actions.js';
import { ingestDiscovered, type DiscoveredItem } from '../../src/workflows/collect.js';
import { buildFollowPreview, loadFollowCandidates } from '../../src/workflows/plan-follow.js';

let db: SqliteDatabase;

function deps() {
  return {
    profiles: new ProfileRepo(db),
    candidates: new CampaignCandidateRepo(db),
    signals: new CandidateSignalRepo(db),
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('ingestDiscovered', () => {
  const items: DiscoveredItem[] = [
    {
      username: 'invest_a',
      source: 'RECENT_POST_COMMENTERS',
      signal: { type: 'COMMENT', mediaShortcode: 'AAA' },
    },
    {
      username: 'invest_a',
      source: 'RECENT_POST_LIKERS',
      signal: { type: 'LIKE', mediaShortcode: 'AAA' },
    },
    {
      username: 'trader_b',
      source: 'RECENT_POST_COMMENTERS',
      signal: { type: 'COMMENT', mediaShortcode: 'AAA' },
    },
    { username: 'nome invalido', source: 'FOLLOWERS' },
  ];

  it('deduplica, valida e prioriza a fonte mais engajada', () => {
    const campaign = new CampaignRepo(db).create({ name: 'C' });
    const summary = ingestDiscovered(deps(), campaign.id, items);

    expect(summary.invalid).toBe(1);
    expect(summary.uniqueUsernames).toBe(2);
    expect(summary.candidatesCreated).toBe(2);

    const candidate = new CampaignCandidateRepo(db).findByCampaignAndProfile(
      campaign.id,
      new ProfileRepo(db).findByUsername('invest_a')!.id,
    );
    expect(candidate?.discoverySource).toBe('RECENT_POST_COMMENTERS');
  });

  it('é idempotente ao reexecutar', () => {
    const campaign = new CampaignRepo(db).create({ name: 'C2' });
    ingestDiscovered(deps(), campaign.id, items);
    const second = ingestDiscovered(deps(), campaign.id, items);
    expect(second.candidatesCreated).toBe(0);
    expect(second.candidatesExisting).toBe(2);
    expect(second.signalsDuplicated).toBeGreaterThan(0);
  });
});

describe('loadFollowCandidates + buildFollowPreview', () => {
  it('pontua por engajamento e exclui whitelist/protegido/já seguido', () => {
    const campaign = new CampaignRepo(db).create({ name: 'Plan' });
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    ingestDiscovered(deps(), campaign.id, [
      {
        username: 'invest_a',
        source: 'RECENT_POST_COMMENTERS',
        signal: { type: 'COMMENT', mediaShortcode: 'AAA' },
      },
      {
        username: 'invest_a',
        source: 'RECENT_POST_LIKERS',
        signal: { type: 'LIKE', mediaShortcode: 'AAA' },
      },
      {
        username: 'trader_b',
        source: 'RECENT_POST_COMMENTERS',
        signal: { type: 'COMMENT', mediaShortcode: 'AAA' },
      },
      { username: 'renda_c', source: 'FOLLOWERS' },
    ]);

    const profiles = new ProfileRepo(db);
    const relationships = new RelationshipRepo(db);

    // renda_c entra na whitelist → excluído.
    const relC = relationships.ensure(account.id, profiles.findByUsername('renda_c')!.id);
    relationships.setWhitelist(relC.id, true);

    // trader_b já é seguido → excluído.
    const relB = relationships.ensure(account.id, profiles.findByUsername('trader_b')!.id);
    relationships.createCycle({
      relationshipId: relB.id,
      origin: 'TOOL_CLICK',
      state: 'FOLLOWING',
    });

    const candidates = loadFollowCandidates(db, campaign.id, account.id);
    const preview = buildFollowPreview(candidates);

    expect(preview.excluded.whitelisted).toBe(1);
    expect(preview.excluded.already_following).toBe(1);
    expect(preview.proposed.map((p) => p.username)).toEqual(['invest_a']);
    expect(preview.proposed[0]?.score).toBe(5);

    const investA = profiles.findByUsername('invest_a')!;
    new ActionAttemptRepo(db).prepare({
      localAccountId: account.id,
      profileId: investA.id,
      actionType: 'FOLLOW',
      idempotencyKey: 'attempt-invest-a',
    });
    const refreshed = loadFollowCandidates(db, campaign.id, account.id);
    const onlyUnattempted = buildFollowPreview(refreshed, { onlyUnattempted: true });
    expect(onlyUnattempted.totalProposed).toBe(0);
    expect(onlyUnattempted.excluded.previously_attempted).toBe(1);
  });
});

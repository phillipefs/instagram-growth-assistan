import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { CampaignCandidateRepo, CampaignRepo } from '../../src/database/repositories/campaigns.js';
import { ActionAttemptRepo } from '../../src/database/repositories/actions.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';
import { buildCampaignSummary } from '../../src/workflows/campaign-summary.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('buildCampaignSummary', () => {
  it('resume candidatos, relacionamentos, tentativas e pendências', () => {
    const account = new LocalAccountRepo(db).create({ username: 'conta' });
    const campaign = new CampaignRepo(db).create({ name: 'Campanha' });
    const profiles = new ProfileRepo(db);
    const candidates = new CampaignCandidateRepo(db);
    const actions = new ActionAttemptRepo(db);
    const relationships = new RelationshipRepo(db);

    const seeded = ['seguindo', 'solicitado', 'ambiguo', 'pulado', 'inedito'].map((username) =>
      profiles.upsert({ username }),
    );
    seeded.forEach((profile, index) =>
      candidates.add({
        campaignId: campaign.id,
        profileId: profile.id,
        discoverySource: index === 4 ? 'RECENT_POST_LIKERS' : 'RECENT_POST_COMMENTERS',
      }),
    );

    const attempt = (index: number, state: 'CONFIRMED' | 'AMBIGUOUS' | 'SKIPPED') => {
      const prepared = actions.prepare({
        localAccountId: account.id,
        profileId: seeded[index]!.id,
        actionType: 'FOLLOW',
        idempotencyKey: `k-${index}`,
      }).attempt;
      if (state === 'SKIPPED') {
        actions.transition(prepared.id, 'SKIPPED');
      } else {
        actions.transition(prepared.id, 'PENDING');
        actions.transition(prepared.id, state);
      }
    };
    attempt(0, 'CONFIRMED');
    attempt(1, 'CONFIRMED');
    attempt(2, 'AMBIGUOUS');
    attempt(3, 'SKIPPED');

    const following = relationships.ensure(account.id, seeded[0]!.id);
    relationships.createCycle({ relationshipId: following.id, origin: 'TOOL_CLICK' });
    const requested = relationships.ensure(account.id, seeded[1]!.id);
    relationships.createCycle({
      relationshipId: requested.id,
      origin: 'TOOL_CLICK',
      state: 'FOLLOW_REQUESTED',
    });

    const summary = buildCampaignSummary(db, campaign.id, account.id);
    expect(summary.candidates.total).toBe(5);
    expect(summary.candidates.bySource).toEqual({
      RECENT_POST_COMMENTERS: 4,
      RECENT_POST_LIKERS: 1,
    });
    expect(summary.currentRelationships).toEqual({ following: 1, requested: 1, total: 2 });
    expect(summary.latestFollowAttempts).toEqual({
      confirmed: 2,
      ambiguous: 1,
      failed: 0,
      skipped: 1,
      pending: 0,
      total: 4,
    });
    expect(summary.remaining).toEqual({ eligible: 3, neverAttempted: 1 });
    expect(summary.excluded).toEqual({
      whitelisted: 0,
      protected: 0,
      alreadyFollowing: 2,
      previouslyAttempted: 2,
    });
  });
});

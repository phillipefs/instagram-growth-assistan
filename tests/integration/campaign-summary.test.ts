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
import { CandidateSignalRepo } from '../../src/database/repositories/candidate-signals.js';
import { buildCampaignSummary } from '../../src/workflows/campaign-summary.js';
import { persistFollowerSnapshot } from '../../src/workflows/sync-followers.js';

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
    const signals = new CandidateSignalRepo(db);

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
    const storedCandidates = candidates.listByCampaign(campaign.id);
    signals.record({
      campaignCandidateId: storedCandidates[0]!.id,
      type: 'COMMENT',
      mediaShortcode: 'POST_A',
    });
    signals.record({
      campaignCandidateId: storedCandidates[1]!.id,
      type: 'COMMENT',
      mediaShortcode: 'POST_A',
    });
    signals.record({
      campaignCandidateId: storedCandidates[4]!.id,
      type: 'LIKE',
      mediaShortcode: 'POST_B',
    });

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
    const followingCycle = relationships.createCycle({
      relationshipId: following.id,
      origin: 'TOOL_CLICK',
      campaignId: campaign.id,
    });
    relationships.setFollowBack(followingCycle.id, 'YES');
    const requested = relationships.ensure(account.id, seeded[1]!.id);
    const requestedCycle = relationships.createCycle({
      relationshipId: requested.id,
      origin: 'TOOL_CLICK',
      state: 'FOLLOW_REQUESTED',
      campaignId: campaign.id,
    });
    relationships.setFollowBack(requestedCycle.id, 'NO');
    const removed = relationships.ensure(account.id, seeded[2]!.id);
    const removedCycle = relationships.createCycle({
      relationshipId: removed.id,
      origin: 'TOOL_CLICK',
      campaignId: campaign.id,
    });
    relationships.closeCycle(removedCycle.id, { unfollowReason: 'fim da campanha' });

    const summary = buildCampaignSummary(db, campaign.id, account.id);
    expect(summary.candidates.total).toBe(5);
    expect(summary.candidates.bySource).toEqual({
      RECENT_POST_COMMENTERS: 4,
      RECENT_POST_LIKERS: 1,
    });
    expect(summary.postsWithSignals).toBe(2);
    expect(summary.engagementSignals).toEqual({ COMMENT: 2, LIKE: 1 });
    expect(summary.currentRelationships).toEqual({ following: 1, requested: 1, total: 2 });
    expect(summary.relationshipHistory).toEqual({
      toolFollowed: 3,
      followCycles: 3,
      unfollowed: 1,
      unfollowEvents: 1,
    });
    expect(summary.followBacks).toEqual({
      yes: 1,
      no: 1,
      unknown: 1,
      checked: 2,
      classified: 2,
      uninspected: 1,
      total: 3,
      coveragePct: 66.67,
    });
    expect(summary.followersSnapshot).toBeNull();
    expect(summary.conversion).toEqual({
      followers: 1,
      confirmedToolFollows: 3,
      ratePct: 33.33,
      confirmedNewFollowers: 0,
      eligibleWithBaseline: 0,
      confirmedRatePct: null,
      attributionUnknown: 3,
    });
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

  it('preserva histórico e conversão quando todos os ciclos foram encerrados', () => {
    const account = new LocalAccountRepo(db).create({ username: 'conta' });
    const campaign = new CampaignRepo(db).create({ name: 'Encerrada' });
    const profile = new ProfileRepo(db).upsert({ username: 'converteu' });
    new CampaignCandidateRepo(db).add({
      campaignId: campaign.id,
      profileId: profile.id,
      discoverySource: 'RECENT_POST_COMMENTERS',
    });
    const relationships = new RelationshipRepo(db);
    const relationship = relationships.ensure(account.id, profile.id);
    const cycle = relationships.createCycle({
      relationshipId: relationship.id,
      origin: 'TOOL_CLICK',
      campaignId: campaign.id,
    });
    relationships.setFollowBack(cycle.id, 'YES');
    relationships.closeCycle(cycle.id, { unfollowReason: 'fim da campanha' });

    const summary = buildCampaignSummary(db, campaign.id, account.id);
    expect(summary.currentRelationships).toEqual({ following: 0, requested: 0, total: 0 });
    expect(summary.relationshipHistory.unfollowed).toBe(1);
    expect(summary.followBacks.yes).toBe(1);
    expect(summary.conversion).toEqual({
      followers: 1,
      confirmedToolFollows: 1,
      ratePct: 100,
      confirmedNewFollowers: 0,
      eligibleWithBaseline: 0,
      confirmedRatePct: null,
      attributionUnknown: 1,
    });
  });

  it('não apresenta zero como conversão antes da primeira inspeção', () => {
    const account = new LocalAccountRepo(db).create({ username: 'conta' });
    const campaign = new CampaignRepo(db).create({ name: 'Sem inspeção' });
    const profile = new ProfileRepo(db).upsert({ username: 'desconhecido' });
    const relationships = new RelationshipRepo(db);
    const relationship = relationships.ensure(account.id, profile.id);
    relationships.createCycle({
      relationshipId: relationship.id,
      origin: 'TOOL_CLICK',
      campaignId: campaign.id,
    });

    const summary = buildCampaignSummary(db, campaign.id, account.id);
    expect(summary.followBacks).toMatchObject({
      unknown: 1,
      checked: 0,
      classified: 0,
      uninspected: 1,
      coveragePct: 0,
    });
    expect(summary.conversion.ratePct).toBeNull();
    expect(summary.conversion.attributionUnknown).toBe(1);
  });

  it('usa o snapshot completo para conversÃ£o atual e separa atribuiÃ§Ã£o com baseline', () => {
    const account = new LocalAccountRepo(db).create({ username: 'conta' });
    const campaign = new CampaignRepo(db).create({ name: 'Com snapshots' });
    const profiles = new ProfileRepo(db);
    const candidates = new CampaignCandidateRepo(db);
    const relationships = new RelationshipRepo(db);
    const converted = profiles.upsert({ username: 'converteu' });
    const didNotConvert = profiles.upsert({ username: 'nao_converteu' });
    const preexisting = profiles.upsert({ username: 'preexistente' });
    for (const profile of [converted, didNotConvert, preexisting]) {
      candidates.add({
        campaignId: campaign.id,
        profileId: profile.id,
        discoverySource: 'RECENT_POST_COMMENTERS',
      });
    }

    persistFollowerSnapshot(db, {
      localAccountId: account.id,
      complete: true,
      expectedCount: 1,
      loadedCount: 1,
      usernames: ['preexistente'],
      observedAt: '2026-01-01T00:00:00.000Z',
      reason: 'lista completa carregada',
    });
    for (const profile of [converted, didNotConvert, preexisting]) {
      const relationship = relationships.ensure(account.id, profile.id);
      relationships.createCycle({
        relationshipId: relationship.id,
        origin: 'TOOL_CLICK',
        campaignId: campaign.id,
        followedAt: '2026-01-02T00:00:00.000Z',
      });
    }
    const latest = persistFollowerSnapshot(db, {
      localAccountId: account.id,
      complete: true,
      expectedCount: 3,
      loadedCount: 3,
      usernames: ['converteu', 'preexistente', 'fora_da_campanha'],
      observedAt: '2026-01-03T00:00:00.000Z',
      reason: 'lista completa carregada',
    });

    const summary = buildCampaignSummary(db, campaign.id, account.id);
    expect(summary.followersSnapshot).toEqual({
      id: latest.snapshot.id,
      observedAt: '2026-01-03T00:00:00.000Z',
      currentTotal: 3,
      currentFromCampaign: 2,
    });
    expect(summary.followBacks).toMatchObject({ yes: 2, no: 1, unknown: 0, checked: 3 });
    expect(summary.conversion).toEqual({
      followers: 2,
      confirmedToolFollows: 3,
      ratePct: 66.67,
      confirmedNewFollowers: 1,
      eligibleWithBaseline: 2,
      confirmedRatePct: 50,
      attributionUnknown: 0,
    });
  });
});

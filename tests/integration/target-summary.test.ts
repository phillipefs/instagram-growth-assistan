import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { CampaignCandidateRepo, CampaignRepo } from '../../src/database/repositories/campaigns.js';
import { CandidateSignalRepo } from '../../src/database/repositories/candidate-signals.js';
import { MediaRepo } from '../../src/database/repositories/media.js';
import { TargetObservationRepo } from '../../src/database/repositories/target-observations.js';
import { buildTargetSummary } from '../../src/workflows/target-summary.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('buildTargetSummary', () => {
  it('agrega campanhas do alvo e deduplica posts, candidatos e sinais', () => {
    const profiles = new ProfileRepo(db);
    const campaigns = new CampaignRepo(db);
    const candidates = new CampaignCandidateRepo(db);
    const signals = new CandidateSignalRepo(db);
    const media = new MediaRepo(db);
    const observations = new TargetObservationRepo(db);
    const target = profiles.upsert({
      username: 'status.invest',
      profileUrl: 'https://www.instagram.com/status.invest/',
    });
    const otherTarget = profiles.upsert({ username: 'outro.alvo' });
    const firstCampaign = campaigns.create({ name: 'Status A', targetProfileId: target.id });
    const secondCampaign = campaigns.create({ name: 'Status B', targetProfileId: target.id });
    campaigns.create({ name: 'Outra', targetProfileId: otherTarget.id });
    const personA = profiles.upsert({ username: 'pessoa_a' });
    const personB = profiles.upsert({ username: 'pessoa_b' });

    const candidateA1 = candidates.add({
      campaignId: firstCampaign.id,
      profileId: personA.id,
      discoverySource: 'RECENT_POST_COMMENTERS',
    }).candidate;
    const candidateA2 = candidates.add({
      campaignId: secondCampaign.id,
      profileId: personA.id,
      discoverySource: 'RECENT_POST_COMMENTERS',
    }).candidate;
    const candidateB = candidates.add({
      campaignId: secondCampaign.id,
      profileId: personB.id,
      discoverySource: 'RECENT_POST_LIKERS',
    }).candidate;
    signals.record({ campaignCandidateId: candidateA1.id, type: 'COMMENT', mediaShortcode: 'AAA' });
    signals.record({ campaignCandidateId: candidateA2.id, type: 'COMMENT', mediaShortcode: 'AAA' });
    signals.record({ campaignCandidateId: candidateB.id, type: 'LIKE', mediaShortcode: 'BBB' });

    media.upsert({
      profileId: target.id,
      shortcode: 'AAA',
      publishedAt: '2026-08-01T00:00:00.000Z',
    });
    media.upsert({
      profileId: target.id,
      shortcode: 'BBB',
      publishedAt: '2026-06-01T00:00:00.000Z',
    });
    media.upsert({ profileId: target.id, shortcode: 'CCC' });
    observations.record(target.id, 2450);

    const summary = buildTargetSummary(db, target);
    expect(summary.target.username).toBe('status.invest');
    expect(summary.campaigns.total).toBe(2);
    expect(summary.campaigns.items.map((campaign) => campaign.name)).toEqual([
      'Status A',
      'Status B',
    ]);
    expect(summary.instagramReportedPosts).toBe(2450);
    expect(summary.collection.postsObserved).toBe(3);
    expect(summary.collection.postsWithSignals).toBe(2);
    expect(summary.collection.postsWithPublishedAt).toBe(2);
    expect(summary.collection.newestPostPublishedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(summary.collection.oldestPostPublishedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(summary.collection.uniqueCandidates).toBe(2);
    expect(summary.collection.engagementSignals).toEqual({
      total: 2,
      byType: { COMMENT: 1, LIKE: 1 },
    });
    expect(summary.collection.firstObservedAt).not.toBeNull();
    expect(summary.collection.lastObservedAt).not.toBeNull();
  });
});

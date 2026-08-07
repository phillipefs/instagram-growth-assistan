import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { CampaignCandidateRepo, CampaignRepo } from '../../src/database/repositories/campaigns.js';
import { CandidateSignalRepo } from '../../src/database/repositories/candidate-signals.js';
import { engagementScore } from '../../src/domain/discovery.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('descoberta e sinais de engajamento', () => {
  it('registra a fonte de descoberta do candidato', () => {
    const campaign = new CampaignRepo(db).create({ name: 'Eng' });
    const profile = new ProfileRepo(db).upsert({ username: 'comentou' });
    const candidates = new CampaignCandidateRepo(db);
    const { candidate } = candidates.add({
      campaignId: campaign.id,
      profileId: profile.id,
      discoverySource: 'RECENT_POST_COMMENTERS',
    });
    expect(candidate.discoverySource).toBe('RECENT_POST_COMMENTERS');
  });

  it('deduplica sinais por (candidato, tipo, mídia) e permite pontuar', () => {
    const campaign = new CampaignRepo(db).create({ name: 'Eng2' });
    const profile = new ProfileRepo(db).upsert({ username: 'engajado' });
    const candidates = new CampaignCandidateRepo(db);
    const signals = new CandidateSignalRepo(db);
    const { candidate } = candidates.add({
      campaignId: campaign.id,
      profileId: profile.id,
      discoverySource: 'RECENT_POST_COMMENTERS',
    });

    const first = signals.record({ campaignCandidateId: candidate.id, type: 'COMMENT', mediaShortcode: 'AAA111' });
    const dup = signals.record({ campaignCandidateId: candidate.id, type: 'COMMENT', mediaShortcode: 'AAA111' });
    signals.record({ campaignCandidateId: candidate.id, type: 'LIKE', mediaShortcode: 'AAA111' });

    expect(first.created).toBe(true);
    expect(dup.created).toBe(false);

    const all = signals.listByCandidate(candidate.id);
    expect(all).toHaveLength(2);
    expect(engagementScore(all)).toBe(5);
  });
});

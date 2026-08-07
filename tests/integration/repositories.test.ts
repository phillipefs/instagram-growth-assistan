import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import {
  CampaignCandidateRepo,
  CampaignRepo,
} from '../../src/database/repositories/campaigns.js';
import { RelationshipRepo } from '../../src/database/repositories/relationships.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('ProfileRepo', () => {
  it('deduplica por username canônico e registra alias em renomeação', () => {
    const repo = new ProfileRepo(db);
    const a = repo.upsert({ username: 'Investidor' });
    const b = repo.upsert({ username: '  investidor ' });
    expect(a.id).toBe(b.id);

    repo.upsert({ username: 'investidor_novo', platformId: 'ig-1' });
    const withPlatform = repo.upsert({ username: 'investidor_novo', platformId: 'ig-1' });
    const renamed = repo.upsert({ username: 'investidor_renomeado', platformId: 'ig-1' });
    expect(renamed.id).toBe(withPlatform.id);
    const aliases = db
      .prepare('SELECT username FROM profile_aliases WHERE profile_id = ?')
      .all(renamed.id) as { username: string }[];
    expect(aliases.map((row) => row.username)).toContain('investidor_renomeado');
  });
});

describe('CampaignCandidateRepo', () => {
  it('impede candidato duplicado na mesma campanha', () => {
    const campaigns = new CampaignRepo(db);
    const profiles = new ProfileRepo(db);
    const candidates = new CampaignCandidateRepo(db);

    const campaign = campaigns.create({ name: 'C1' });
    const profile = profiles.upsert({ username: 'trader' });

    const first = candidates.add({ campaignId: campaign.id, profileId: profile.id });
    const second = candidates.add({ campaignId: campaign.id, profileId: profile.id });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.candidate.id).toBe(second.candidate.id);
    expect(candidates.countByCampaign(campaign.id)).toBe(1);
  });
});

describe('RelationshipRepo (ciclos)', () => {
  it('marca followed_by_tool a partir de TOOL_CLICK e fecha o ciclo', () => {
    const accounts = new LocalAccountRepo(db);
    const profiles = new ProfileRepo(db);
    const relationships = new RelationshipRepo(db);

    const account = accounts.create({ username: 'minha_conta' });
    const profile = profiles.upsert({ username: 'candidato' });
    const relationship = relationships.ensure(account.id, profile.id);

    const cycle = relationships.createCycle({
      relationshipId: relationship.id,
      origin: 'TOOL_CLICK',
    });
    expect(cycle.followedByTool).toBe(true);
    expect(relationships.getOpenCycle(relationship.id)?.id).toBe(cycle.id);

    relationships.closeCycle(cycle.id, { unfollowReason: 'teste' });
    expect(relationships.getOpenCycle(relationship.id)).toBeUndefined();
  });

  it('não marca followed_by_tool para follow manual observado', () => {
    const accounts = new LocalAccountRepo(db);
    const profiles = new ProfileRepo(db);
    const relationships = new RelationshipRepo(db);

    const account = accounts.create({ username: 'c2' });
    const profile = profiles.upsert({ username: 'manual' });
    const relationship = relationships.ensure(account.id, profile.id);
    const cycle = relationships.createCycle({
      relationshipId: relationship.id,
      origin: 'USER_CLICK_OBSERVED',
    });
    expect(cycle.followedByTool).toBe(false);
  });
});

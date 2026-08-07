import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { CampaignRepo } from '../../src/database/repositories/campaigns.js';
import { MediaRepo } from '../../src/database/repositories/media.js';
import type { ProfileType } from '../../src/browser/profile-detector.js';
import type { PostCandidate } from '../../src/domain/recent-post.js';
import type { Confirmer } from '../../src/workflows/follow.js';
import type { LikeState } from '../../src/workflows/like-result.js';
import { runLike, type LikeDriver, type LikeItem } from '../../src/workflows/like.js';

let db: SqliteDatabase;

class FakeLikeDriver implements LikeDriver {
  likeCalls = 0;
  constructor(
    private readonly opts: {
      profileType?: ProfileType;
      posts?: PostCandidate[];
      likeState?: LikeState;
      likeResult?: LikeState;
    } = {},
  ) {}
  inspectProfile() {
    return Promise.resolve({
      safetyState: 'SAFE' as const,
      profileType: this.opts.profileType ?? ('PUBLIC' as ProfileType),
      posts: this.opts.posts ?? [{ shortcode: 'AAA', positionIndex: 0, publishedAt: '2026-08-05T00:00:00.000Z' }],
      finalUrl: 'file://profile',
    });
  }
  openPost() {
    return Promise.resolve({
      safetyState: 'SAFE' as const,
      likeState: this.opts.likeState ?? ('NOT_LIKED' as LikeState),
      postUrl: 'file://post',
    });
  }
  performLike() {
    this.likeCalls += 1;
    return Promise.resolve(this.opts.likeResult ?? ('LIKED' as LikeState));
  }
  screenshot() {
    return Promise.resolve(null);
  }
}

const yesConfirmer: Confirmer = {
  confirmBatch: () => Promise.resolve(true),
  confirmItem: () => Promise.resolve(true),
  waitForManual: () => Promise.resolve(),
};

function seedItems(usernames: string[], campaignId?: string): LikeItem[] {
  const profiles = new ProfileRepo(db);
  return usernames.map((username) => {
    const profile = profiles.upsert({ username });
    return { profileId: profile.id, username, profileUrl: `file://${username}`, ...(campaignId ? { campaignId } : {}) };
  });
}

function options(accountId: string, mode: 'dry-run' | 'manual' | 'confirm-each', limit: number) {
  return {
    mode,
    limit,
    accountId,
    accountUsername: 'minha_conta',
    accountShouldStop: false,
    maxAgeDays: 30,
    now: new Date('2026-08-06T00:00:00.000Z'),
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('runLike', () => {
  it('dry-run apenas lista', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeLikeDriver();
    const summary = await runLike(db, seedItems(['u1']), driver, yesConfirmer, options(account.id, 'dry-run', 0));
    expect(summary.proposedUsernames).toEqual(['u1']);
    expect(driver.likeCalls).toBe(0);
  });

  it('confirm-each curte, registra mídia e é único por campanha', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const campaign = new CampaignRepo(db).create({ name: 'Camp' });
    const items = seedItems(['u1'], campaign.id);
    const driver = new FakeLikeDriver();

    const first = await runLike(db, items, driver, yesConfirmer, options(account.id, 'confirm-each', 5));
    expect(first.confirmed).toBe(1);
    expect(new MediaRepo(db).findByShortcode('AAA')).toBeDefined();

    const second = await runLike(db, items, driver, yesConfirmer, options(account.id, 'confirm-each', 5));
    expect(second.confirmed).toBe(0);
    expect(second.skipped).toBe(1);
    expect(driver.likeCalls).toBe(1);
  });

  it('pula perfil privado', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeLikeDriver({ profileType: 'PRIVATE' });
    const summary = await runLike(db, seedItems(['u1']), driver, yesConfirmer, options(account.id, 'confirm-each', 5));
    expect(summary.skipped).toBe(1);
    expect(driver.likeCalls).toBe(0);
  });

  it('pula publicação já curtida', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeLikeDriver({ likeState: 'LIKED' });
    const summary = await runLike(db, seedItems(['u1']), driver, yesConfirmer, options(account.id, 'confirm-each', 5));
    expect(summary.skipped).toBe(1);
    expect(driver.likeCalls).toBe(0);
  });

  it('pula quando não há publicação recente', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeLikeDriver({ posts: [] });
    const summary = await runLike(db, seedItems(['u1']), driver, yesConfirmer, options(account.id, 'confirm-each', 5));
    expect(summary.skipped).toBe(1);
  });

  it('fecha em resultado ambíguo', async () => {
    const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
    const driver = new FakeLikeDriver({ likeResult: 'NOT_LIKED' });
    const summary = await runLike(db, seedItems(['u1']), driver, yesConfirmer, options(account.id, 'confirm-each', 5));
    expect(summary.ambiguous).toBe(1);
    expect(summary.stopped).toBe(true);
  });
});

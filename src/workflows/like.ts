import type { SqliteDatabase } from '../database/connection.js';
import type { SafetyState } from '../domain/states.js';
import type { ProfileType } from '../browser/profile-detector.js';
import { canonicalUsername } from '../database/util.js';
import { buildIdempotencyKey } from '../domain/idempotency.js';
import { selectRecentPost, type PostCandidate } from '../domain/recent-post.js';
import { MediaRepo } from '../database/repositories/media.js';
import { ActionAttemptRepo } from '../database/repositories/actions.js';
import { interpretLikeResult, type LikeState } from './like-result.js';
import type { Confirmer } from './follow.js';

export type LikeMode = 'dry-run' | 'manual' | 'confirm-each';

export interface LikeItem {
  readonly profileId: string;
  readonly username: string;
  readonly profileUrl: string;
  readonly campaignId?: string;
}

export interface ProfileForLike {
  readonly safetyState: SafetyState;
  readonly profileType: ProfileType;
  readonly posts: PostCandidate[];
  readonly finalUrl: string;
}

export interface OpenedPost {
  readonly safetyState: SafetyState;
  readonly likeState: LikeState;
  readonly postUrl: string;
}

export interface LikeDriver {
  inspectProfile(profileUrl: string): Promise<ProfileForLike>;
  openPost(shortcode: string): Promise<OpenedPost>;
  performLike(): Promise<LikeState>;
  screenshot(label: string): Promise<string | null>;
}

export interface RunLikeOptions {
  readonly mode: LikeMode;
  readonly limit: number;
  readonly accountId: string;
  readonly accountUsername: string;
  readonly accountShouldStop: boolean;
  readonly maxAgeDays: number;
  readonly now?: Date;
  readonly runId?: string;
}

export interface LikeSummary {
  mode: LikeMode;
  proposed: number;
  confirmed: number;
  skipped: number;
  review: number;
  ambiguous: number;
  failed: number;
  stopped: boolean;
  stopReason: string | null;
  proposedUsernames?: string[];
}

function zero(mode: LikeMode, proposed: number): LikeSummary {
  return {
    mode,
    proposed,
    confirmed: 0,
    skipped: 0,
    review: 0,
    ambiguous: 0,
    failed: 0,
    stopped: false,
    stopReason: null,
  };
}

/**
 * Curte no máximo uma publicação recente por candidato, de forma supervisionada.
 * Sem lote autônomo: apenas `dry-run`, `manual` e `confirm-each`.
 */
export async function runLike(
  db: SqliteDatabase,
  items: readonly LikeItem[],
  driver: LikeDriver,
  confirmer: Confirmer,
  options: RunLikeOptions,
): Promise<LikeSummary> {
  if (options.mode === 'dry-run') {
    return {
      ...zero('dry-run', items.length),
      stopReason: 'dry-run: nenhuma ação real',
      proposedUsernames: items.map((i) => i.username),
    };
  }

  const summary = zero(options.mode, items.length);
  const media = new MediaRepo(db);
  const actions = new ActionAttemptRepo(db);
  const cap = options.limit > 0 ? options.limit : 0;

  for (const item of items) {
    if (summary.confirmed >= cap) {
      summary.stopped = true;
      summary.stopReason = 'limite de ações reais atingido';
      break;
    }

    // Uma curtida por candidato por campanha.
    if (actions.hasConfirmedAction(item.profileId, 'LIKE_POST', item.campaignId)) {
      summary.skipped += 1;
      continue;
    }

    const profile = await driver.inspectProfile(item.profileUrl);
    if (profile.safetyState !== 'SAFE') {
      summary.stopped = true;
      summary.stopReason = `perfil não seguro: ${profile.safetyState}`;
      break;
    }
    if (options.accountShouldStop) {
      summary.stopped = true;
      summary.stopReason = 'conta ativa divergente';
      break;
    }
    if (profile.profileType !== 'PUBLIC') {
      summary.skipped += 1;
      continue;
    }

    const selection = selectRecentPost(profile.posts, {
      maxAgeDays: options.maxAgeDays,
      ...(options.now ? { now: options.now } : {}),
    });
    if (!selection.post) {
      summary.skipped += 1;
      continue;
    }
    const post = selection.post;

    const opened = await driver.openPost(post.shortcode);
    if (opened.safetyState !== 'SAFE') {
      summary.stopped = true;
      summary.stopReason = `publicação não segura: ${opened.safetyState}`;
      break;
    }
    if (opened.likeState === 'LIKED') {
      summary.skipped += 1;
      continue;
    }
    if (opened.likeState === 'UNKNOWN') {
      summary.review += 1;
      continue;
    }

    if (options.mode === 'confirm-each') {
      const ok = await confirmer.confirmItem(`Curtir a publicação ${opened.postUrl} de @${item.username}?`);
      if (!ok) {
        summary.skipped += 1;
        continue;
      }
    }

    const key = buildIdempotencyKey({
      localAccount: options.accountUsername,
      actionType: 'LIKE_POST',
      targetEntityId: canonicalUsername(item.username),
      mediaId: post.shortcode,
    });
    const existing = actions.findByIdempotencyKey(key);
    if (existing && existing.state === 'CONFIRMED') {
      summary.skipped += 1;
      continue;
    }

    const mediaRow = media.upsert({
      profileId: item.profileId,
      shortcode: post.shortcode,
      url: opened.postUrl,
      ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
      isPinned: post.isPinned ?? false,
    });

    const prep = actions.prepare({
      localAccountId: options.accountId,
      profileId: item.profileId,
      actionType: 'LIKE_POST',
      idempotencyKey: key,
      mediaId: mediaRow.id,
      ...(item.campaignId ? { campaignId: item.campaignId } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
    });

    if (options.mode === 'manual') {
      await confirmer.waitForManual(`Curta manualmente ${opened.postUrl} de @${item.username}.`);
    }

    actions.transition(prep.attempt.id, 'PENDING');
    let after: LikeState;
    try {
      after = options.mode === 'manual' ? (await driver.openPost(post.shortcode)).likeState : await driver.performLike();
    } catch (error) {
      const shot = await driver.screenshot(`like-failed-${item.username}-${post.shortcode}`);
      actions.transition(prep.attempt.id, 'FAILED', {
        result: `erro ao curtir: ${String(error)}`,
        ...(shot ? { screenshotPath: shot } : {}),
      });
      summary.failed += 1;
      summary.stopped = true;
      summary.stopReason = 'falha na ação';
      break;
    }

    const interpreted = interpretLikeResult(after);
    if (interpreted.result === 'CONFIRMED') {
      const shot = await driver.screenshot(`like-${item.username}-${post.shortcode}`);
      actions.transition(prep.attempt.id, 'CONFIRMED', {
        result: interpreted.detail,
        ...(shot ? { screenshotPath: shot } : {}),
      });
      summary.confirmed += 1;
      continue;
    }
    const shot = await driver.screenshot(`like-ambiguous-${item.username}-${post.shortcode}`);
    actions.transition(prep.attempt.id, interpreted.result, {
      result: interpreted.detail,
      ...(shot ? { screenshotPath: shot } : {}),
    });
    summary.ambiguous += 1;
    summary.stopped = true;
    summary.stopReason = 'resultado ambíguo; revisão manual necessária';
    break;
  }

  return summary;
}

/** Driver mínimo para curtir logo após seguir (reaproveita a sessão do follow). */
export interface LikeAfterFollowDriver {
  readRecentPosts(profileUrl: string): Promise<PostCandidate[]>;
  openPost(shortcode: string): Promise<OpenedPost>;
  performLike(): Promise<LikeState>;
  screenshot(label: string): Promise<string | null>;
}

export type LikeAfterFollowOutcome =
  | 'LIKED'
  | 'ALREADY_LIKED'
  | 'ALREADY_DONE'
  | 'NO_POST'
  | 'REVIEW'
  | 'AMBIGUOUS'
  | 'FAILED';

/**
 * Curte, de forma automática, a publicação recente de um perfil já seguido.
 * Uma curtida por candidato por campanha; pula sem post/privado/já curtido.
 * Registra a tentativa `LIKE_POST` de forma idempotente.
 */
export async function likeRecentPostForProfile(
  db: SqliteDatabase,
  driver: LikeAfterFollowDriver,
  item: LikeItem,
  options: { accountId: string; accountUsername: string; maxAgeDays: number; now?: Date; runId?: string },
): Promise<LikeAfterFollowOutcome> {
  const media = new MediaRepo(db);
  const actions = new ActionAttemptRepo(db);

  if (actions.hasConfirmedAction(item.profileId, 'LIKE_POST', item.campaignId)) {
    return 'ALREADY_DONE';
  }

  const posts = await driver.readRecentPosts(item.profileUrl);
  const selection = selectRecentPost(posts, {
    maxAgeDays: options.maxAgeDays,
    ...(options.now ? { now: options.now } : {}),
  });
  if (!selection.post) {
    return 'NO_POST';
  }
  const post = selection.post;

  const opened = await driver.openPost(post.shortcode);
  if (opened.safetyState !== 'SAFE') {
    return 'REVIEW';
  }
  if (opened.likeState === 'LIKED') {
    return 'ALREADY_LIKED';
  }
  if (opened.likeState === 'UNKNOWN') {
    return 'REVIEW';
  }

  const key = buildIdempotencyKey({
    localAccount: options.accountUsername,
    actionType: 'LIKE_POST',
    targetEntityId: canonicalUsername(item.username),
    mediaId: post.shortcode,
  });
  const existing = actions.findByIdempotencyKey(key);
  if (existing && existing.state === 'CONFIRMED') {
    return 'ALREADY_DONE';
  }

  const mediaRow = media.upsert({
    profileId: item.profileId,
    shortcode: post.shortcode,
    url: opened.postUrl,
    ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
    isPinned: post.isPinned ?? false,
  });

  const prep = actions.prepare({
    localAccountId: options.accountId,
    profileId: item.profileId,
    actionType: 'LIKE_POST',
    idempotencyKey: key,
    mediaId: mediaRow.id,
    ...(item.campaignId ? { campaignId: item.campaignId } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
  });
  actions.transition(prep.attempt.id, 'PENDING');

  let after: LikeState;
  try {
    after = await driver.performLike();
  } catch (error) {
    const shot = await driver.screenshot(`like-after-follow-failed-${item.username}`);
    actions.transition(prep.attempt.id, 'FAILED', {
      result: `erro ao curtir: ${String(error)}`,
      ...(shot ? { screenshotPath: shot } : {}),
    });
    return 'FAILED';
  }

  const interpreted = interpretLikeResult(after);
  const shot = await driver.screenshot(`like-after-follow-${item.username}-${post.shortcode}`);
  actions.transition(prep.attempt.id, interpreted.result, {
    result: interpreted.detail,
    ...(shot ? { screenshotPath: shot } : {}),
  });
  return interpreted.result === 'CONFIRMED' ? 'LIKED' : 'AMBIGUOUS';
}

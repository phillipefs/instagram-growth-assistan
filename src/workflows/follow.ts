import type { SqliteDatabase } from '../database/connection.js';
import type { SafetyState } from '../domain/states.js';
import type { ExecutionMode } from '../config/schema.js';
import type { ObservedRelationship } from '../browser/profile-detector.js';
import type { PerformFollowResult } from '../browser/follow-action.js';
import { canonicalUsername } from '../database/util.js';
import { RelationshipRepo } from '../database/repositories/relationships.js';
import { ActionAttemptRepo } from '../database/repositories/actions.js';
import { runActionBatch, type BatchItem, type BatchProgress } from './execution.js';
import { evaluatePreAction, type PreActionDecision } from './pre-action.js';
import {
  likeRecentPostForProfile,
  type LikeAfterFollowDriver,
  type LikeAfterFollowOutcome,
} from './like.js';
import { interpretFollowResult } from './follow-result.js';

export interface FollowItem {
  readonly profileId: string;
  readonly username: string;
  readonly profileUrl: string;
  readonly planItemId?: string;
  readonly campaignId?: string;
}

export interface FollowInspection {
  readonly safetyState: SafetyState;
  readonly relationship: ObservedRelationship;
  readonly finalUrl: string;
  readonly followersCount?: number | null;
  readonly followingCount?: number | null;
}

export interface FollowDriver {
  inspect(profileUrl: string): Promise<FollowInspection>;
  performFollow(expectedUsername: string): Promise<PerformFollowResult>;
  screenshot(label: string): Promise<string | null>;
}

export interface Confirmer {
  confirmBatch(message: string): Promise<boolean>;
  confirmItem(message: string): Promise<boolean>;
  waitForManual(message: string): Promise<void>;
}

export interface RunFollowOptions {
  readonly mode: ExecutionMode;
  readonly limit: number;
  readonly accountId: string;
  readonly accountUsername: string;
  readonly accountShouldStop: boolean;
  readonly planFrozen: boolean;
  readonly runId?: string;
  readonly onProgress?: (progress: BatchProgress) => void;
  /** Pula perfis com seguidores < N; contador desconhecido vai para revisão. Zero desliga. */
  readonly skipInactiveBelow?: number;
  /** Quando true, curte 1 publicação recente ao seguir um perfil ABERTO. */
  readonly likeAfterFollow?: boolean;
  readonly likeMaxAgeDays?: number;
  readonly likeDriver?: LikeAfterFollowDriver;
  readonly onLike?: (info: { username: string; outcome: LikeAfterFollowOutcome }) => void;
}

export interface FollowSummary {
  mode: ExecutionMode;
  proposed: number;
  confirmed: number;
  skipped: number;
  review: number;
  ambiguous: number;
  failed: number;
  idempotentSkips: number;
  liked: number;
  stopped: boolean;
  stopReason: string | null;
  proposedUsernames?: string[];
}

function zeroSummary(mode: ExecutionMode, proposed: number): FollowSummary {
  return {
    mode,
    proposed,
    confirmed: 0,
    skipped: 0,
    review: 0,
    ambiguous: 0,
    failed: 0,
    idempotentSkips: 0,
    liked: 0,
    stopped: false,
    stopReason: null,
  };
}

function persistConfirmedFollow(
  relationships: RelationshipRepo,
  accountId: string,
  item: FollowItem,
  after: ObservedRelationship,
): void {
  const rel = relationships.ensure(accountId, item.profileId);
  if (relationships.getOpenCycle(rel.id)) {
    return;
  }
  relationships.createCycle({
    relationshipId: rel.id,
    origin: 'TOOL_CLICK',
    state: after === 'FOLLOW_REQUESTED' ? 'FOLLOW_REQUESTED' : 'FOLLOWING',
    ...(item.campaignId ? { campaignId: item.campaignId } : {}),
  });
}

/**
 * Executa o follow supervisionado nos modos suportados.
 *
 * - `dry-run`: apenas lista o que seria feito (nenhuma ação real).
 * - `manual`: abre o perfil e aguarda o usuário seguir manualmente.
 * - `confirm-each`: confirma cada item e executa um clique.
 * - `supervised-batch`: uma confirmação para o lote e um clique por item.
 */
export async function runFollow(
  db: SqliteDatabase,
  items: readonly FollowItem[],
  driver: FollowDriver,
  confirmer: Confirmer,
  options: RunFollowOptions,
): Promise<FollowSummary> {
  if (options.mode === 'dry-run') {
    return {
      ...zeroSummary('dry-run', items.length),
      stopReason: 'dry-run: nenhuma ação real',
      proposedUsernames: items.map((i) => i.username),
    };
  }

  const relationships = new RelationshipRepo(db);

  if (options.mode === 'manual') {
    return runManual(items, driver, confirmer, relationships, options);
  }

  if (options.mode === 'supervised-batch') {
    const list = items.map((i) => `@${i.username}`).join(', ');
    const ok = await confirmer.confirmBatch(
      `Iniciar lote supervisionado de follow em ${items.length} conta(s) (limite ${options.limit}): ${list}?`,
    );
    if (!ok) {
      return {
        ...zeroSummary('supervised-batch', items.length),
        stopped: true,
        stopReason: 'lote não confirmado',
      };
    }
  }

  const actions = new ActionAttemptRepo(db);
  const byProfile = new Map(items.map((i) => [i.profileId, i]));
  const observed = new Map<string, ObservedRelationship>();

  const batchItems: BatchItem[] = items.map((i) => ({
    profileId: i.profileId,
    targetEntityId: canonicalUsername(i.username),
    ...(i.campaignId ? { campaignId: i.campaignId } : {}),
    ...(i.planItemId ? { planItemId: i.planItemId } : {}),
  }));

  const getItem = (profileId: string): FollowItem => {
    const item = byProfile.get(profileId);
    if (!item) {
      throw new Error(`Item não encontrado para profileId ${profileId}`);
    }
    return item;
  };

  let likedCount = 0;

  const summary = await runActionBatch(
    actions,
    batchItems,
    {
      localAccountId: options.accountId,
      localAccountUsername: options.accountUsername,
      actionType: 'FOLLOW',
      limit: options.limit,
      ...(options.runId ? { runId: options.runId } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    },
    {
      evaluate: async (bi): Promise<PreActionDecision> => {
        const item = getItem(bi.profileId);
        const insp = await driver.inspect(item.profileUrl);
        observed.set(bi.profileId, insp.relationship);
        const decision = evaluatePreAction({
          intent: 'FOLLOW',
          safetyState: insp.safetyState,
          accountShouldStop: options.accountShouldStop,
          planFrozen: options.planFrozen,
          observedRelationship: insp.relationship,
        });
        if (decision.outcome !== 'PROCEED') {
          return decision;
        }
        const threshold = options.skipInactiveBelow ?? 0;
        if (threshold > 0) {
          if (insp.followersCount == null) {
            return {
              outcome: 'REVIEW',
              reason: `quantidade de seguidores desconhecida; filtro mínimo de ${threshold} ativo`,
            };
          }
          if (insp.followersCount < threshold) {
            return {
              outcome: 'SKIP',
              reason: `abaixo do mínimo: ${insp.followersCount} seguidores (exigido ${threshold})`,
            };
          }
        }
        if (options.mode === 'confirm-each') {
          const ok = await confirmer.confirmItem(`Seguir @${item.username}? (${insp.finalUrl})`);
          if (!ok) {
            return { outcome: 'SKIP', reason: 'recusado pelo usuário' };
          }
        }
        return decision;
      },
      execute: async (bi) => {
        const item = getItem(bi.profileId);
        const before = observed.get(bi.profileId) ?? 'UNKNOWN';
        let performed: PerformFollowResult;
        try {
          performed = await driver.performFollow(item.username);
        } catch (error) {
          const shot = await driver.screenshot(`follow-failed-${item.username}`);
          return {
            result: 'FAILED',
            detail: `erro ao seguir: ${String(error)}`,
            ...(shot ? { screenshotPath: shot } : {}),
          };
        }
        if (!performed.clicked) {
          const shot = await driver.screenshot(`follow-skipped-no-button-${item.username}`);
          return {
            result: 'SKIPPED',
            detail: `${performed.notClickedReason ?? 'botão principal Seguir ausente no momento da ação'}; nenhum clique realizado`,
            ...(shot ? { screenshotPath: shot } : {}),
          };
        }
        const after = performed.relationship;
        const interpreted = interpretFollowResult(before, after);
        if (interpreted.result !== 'CONFIRMED') {
          const shot = await driver.screenshot(`follow-ambiguous-${item.username}`);
          return { ...interpreted, ...(shot ? { screenshotPath: shot } : {}) };
        }
        persistConfirmedFollow(relationships, options.accountId, item, after);
        // Curtida opcional logo após seguir, apenas em perfil ABERTO (FOLLOWING).
        // Nunca deixa a curtida derrubar o fluxo de follow.
        if (options.likeAfterFollow && options.likeDriver && after === 'FOLLOWING') {
          let outcome: LikeAfterFollowOutcome;
          try {
            outcome = await likeRecentPostForProfile(db, options.likeDriver, item, {
              accountId: options.accountId,
              accountUsername: options.accountUsername,
              maxAgeDays: options.likeMaxAgeDays ?? 30,
              ...(options.runId ? { runId: options.runId } : {}),
            });
          } catch {
            outcome = 'FAILED';
          }
          if (outcome === 'LIKED') {
            likedCount += 1;
          }
          options.onLike?.({ username: item.username, outcome });
        }
        const shot = await driver.screenshot(`follow-${item.username}`);
        return {
          result: 'CONFIRMED',
          detail: interpreted.detail,
          ...(shot ? { screenshotPath: shot } : {}),
        };
      },
    },
  );

  return { mode: options.mode, proposed: items.length, liked: likedCount, ...summary };
}

async function runManual(
  items: readonly FollowItem[],
  driver: FollowDriver,
  confirmer: Confirmer,
  relationships: RelationshipRepo,
  options: RunFollowOptions,
): Promise<FollowSummary> {
  const summary = zeroSummary('manual', items.length);
  const cap = options.limit > 0 ? options.limit : items.length;

  for (const item of items.slice(0, cap)) {
    const insp = await driver.inspect(item.profileUrl);
    const decision = evaluatePreAction({
      intent: 'FOLLOW',
      safetyState: insp.safetyState,
      accountShouldStop: options.accountShouldStop,
      planFrozen: options.planFrozen,
      observedRelationship: insp.relationship,
    });
    if (decision.outcome === 'STOP') {
      summary.stopped = true;
      summary.stopReason = decision.reason;
      break;
    }
    if (decision.outcome !== 'PROCEED') {
      summary.skipped += 1;
      continue;
    }
    await confirmer.waitForManual(`Abra @${item.username} e siga manualmente. (${insp.finalUrl})`);
    const after = (await driver.inspect(item.profileUrl)).relationship;
    if (after === 'FOLLOWING' || after === 'FOLLOW_REQUESTED') {
      const rel = relationships.ensure(options.accountId, item.profileId);
      if (!relationships.getOpenCycle(rel.id)) {
        relationships.createCycle({
          relationshipId: rel.id,
          origin: 'USER_CLICK_OBSERVED',
          state: after === 'FOLLOW_REQUESTED' ? 'FOLLOW_REQUESTED' : 'FOLLOWING',
          ...(item.campaignId ? { campaignId: item.campaignId } : {}),
        });
      }
      summary.confirmed += 1;
    } else {
      summary.skipped += 1;
    }
  }
  return summary;
}

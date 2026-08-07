import type { SqliteDatabase } from '../database/connection.js';
import type { SafetyState, FollowBackState } from '../domain/states.js';
import type { ExecutionMode } from '../config/schema.js';
import type { ObservedRelationship } from '../browser/profile-detector.js';
import { canonicalUsername } from '../database/util.js';
import { isObservationFresh } from '../domain/follow-back.js';
import { RelationshipRepo, type RelationshipCycle } from '../database/repositories/relationships.js';
import { ActionAttemptRepo } from '../database/repositories/actions.js';
import { runActionBatch, type BatchItem, type BatchProgress } from './execution.js';
import { evaluatePreAction, type PreActionContext, type PreActionDecision } from './pre-action.js';
import { interpretUnfollowResult } from './unfollow-result.js';
import type { Confirmer } from './follow.js';

export interface UnfollowItem {
  readonly profileId: string;
  readonly username: string;
  readonly profileUrl: string;
  readonly relationshipCycleId: string;
  readonly planItemId?: string;
  readonly campaignId?: string;
}

export interface UnfollowInspection {
  readonly safetyState: SafetyState;
  readonly relationship: ObservedRelationship;
  readonly finalUrl: string;
}

export interface UnfollowDriver {
  inspect(profileUrl: string): Promise<UnfollowInspection>;
  performUnfollow(): Promise<ObservedRelationship>;
  screenshot(label: string): Promise<string | null>;
}

export interface RunUnfollowOptions {
  readonly mode: ExecutionMode;
  readonly limit: number;
  readonly accountId: string;
  readonly accountUsername: string;
  readonly accountShouldStop: boolean;
  readonly planFrozen: boolean;
  readonly preserveFollowBacks: boolean;
  readonly followBackValidityDays: number;
  readonly now?: Date;
  readonly runId?: string;
  readonly onProgress?: (progress: BatchProgress) => void;
}

export interface UnfollowSummary {
  mode: ExecutionMode;
  proposed: number;
  confirmed: number;
  skipped: number;
  review: number;
  ambiguous: number;
  failed: number;
  idempotentSkips: number;
  synced: number;
  stopped: boolean;
  stopReason: string | null;
  proposedUsernames?: string[];
}

function zeroSummary(mode: ExecutionMode, proposed: number): UnfollowSummary {
  return {
    mode,
    proposed,
    confirmed: 0,
    skipped: 0,
    review: 0,
    ambiguous: 0,
    failed: 0,
    idempotentSkips: 0,
    synced: 0,
    stopped: false,
    stopReason: null,
  };
}

/** Follow-back efetivo para a guarda: `NO` só vale se ainda fresco; senão UNKNOWN. */
function effectiveFollowBack(cycle: RelationshipCycle, validityDays: number, now: Date): FollowBackState {
  if (cycle.followBack === 'NO' && isObservationFresh(cycle.followBackCheckedAt, validityDays, now)) {
    return 'NO';
  }
  return cycle.followBack === 'YES' ? 'YES' : 'UNKNOWN';
}

function guardContext(
  insp: UnfollowInspection,
  cycle: RelationshipCycle,
  whitelisted: boolean,
  isProtected: boolean,
  options: RunUnfollowOptions,
  now: Date,
): PreActionContext {
  return {
    intent: 'UNFOLLOW',
    safetyState: insp.safetyState,
    accountShouldStop: options.accountShouldStop,
    planFrozen: options.planFrozen,
    observedRelationship: insp.relationship,
    whitelisted,
    protected: isProtected,
    followedByTool: cycle.followedByTool,
    preserveFollowBacks: options.preserveFollowBacks,
    followBack: effectiveFollowBack(cycle, options.followBackValidityDays, now),
  };
}

/**
 * Executa o unfollow supervisionado nos modos suportados.
 *
 * - `dry-run`: apenas lista o que seria feito (nenhuma ação real).
 * - `manual`: abre o perfil e aguarda o usuário deixar de seguir manualmente.
 * - `confirm-each`: confirma cada item e executa uma saída.
 * - `supervised-batch`: uma confirmação para o lote e uma saída por item.
 *
 * Revalida por item ao vivo (segurança, conta, origem, whitelist, proteção,
 * follow-back e se ainda segue). Se o usuário já deixou de seguir, sincroniza
 * sem clique. Solicitação pendente é cancelada (não é "unfollow").
 */
export async function runUnfollow(
  db: SqliteDatabase,
  items: readonly UnfollowItem[],
  driver: UnfollowDriver,
  confirmer: Confirmer,
  options: RunUnfollowOptions,
): Promise<UnfollowSummary> {
  if (options.mode === 'dry-run') {
    return {
      ...zeroSummary('dry-run', items.length),
      stopReason: 'dry-run: nenhuma ação real',
      proposedUsernames: items.map((i) => i.username),
    };
  }

  const relationships = new RelationshipRepo(db);
  const now = options.now ?? new Date();

  if (options.mode === 'manual') {
    return runManual(relationships, items, driver, confirmer, options, now);
  }

  if (options.mode === 'supervised-batch') {
    const list = items.map((i) => `@${i.username}`).join(', ');
    const ok = await confirmer.confirmBatch(
      `Iniciar lote supervisionado de unfollow em ${items.length} conta(s) (limite ${options.limit}): ${list}?`,
    );
    if (!ok) {
      return { ...zeroSummary('supervised-batch', items.length), stopped: true, stopReason: 'lote não confirmado' };
    }
  }

  const actions = new ActionAttemptRepo(db);
  const byProfile = new Map(items.map((i) => [i.profileId, i]));
  const observed = new Map<string, ObservedRelationship>();
  let synced = 0;

  const getItem = (profileId: string): UnfollowItem => {
    const item = byProfile.get(profileId);
    if (!item) {
      throw new Error(`Item não encontrado para profileId ${profileId}`);
    }
    return item;
  };

  const batchItems: BatchItem[] = items.map((i) => ({
    profileId: i.profileId,
    targetEntityId: canonicalUsername(i.username),
    relationshipCycleId: i.relationshipCycleId,
    ...(i.campaignId ? { campaignId: i.campaignId } : {}),
    ...(i.planItemId ? { planItemId: i.planItemId } : {}),
  }));

  const summary = await runActionBatch(
    actions,
    batchItems,
    {
      localAccountId: options.accountId,
      localAccountUsername: options.accountUsername,
      actionType: 'UNFOLLOW',
      limit: options.limit,
      ...(options.runId ? { runId: options.runId } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    },
    {
      evaluate: async (bi): Promise<PreActionDecision> => {
        const item = getItem(bi.profileId);
        const cycle = relationships.findCycleById(item.relationshipCycleId);
        if (!cycle) {
          return { outcome: 'SKIP', reason: 'ciclo de relacionamento não encontrado' };
        }
        if (cycle.unfollowedAt) {
          return { outcome: 'SKIP', reason: 'ciclo já encerrado' };
        }
        const rel = relationships.findById(cycle.relationshipId);
        const insp = await driver.inspect(item.profileUrl);
        observed.set(bi.profileId, insp.relationship);
        const decision = evaluatePreAction(
          guardContext(insp, cycle, rel?.whitelisted ?? false, rel?.protected ?? false, options, now),
        );
        // Sincroniza sem clique quando o usuário já deixou de seguir manualmente.
        if (decision.outcome !== 'PROCEED' && insp.relationship === 'NOT_FOLLOWING') {
          relationships.closeCycle(cycle.id, { unfollowReason: 'sync: já não seguia' });
          synced += 1;
        }
        if (decision.outcome !== 'PROCEED') {
          return decision;
        }
        if (options.mode === 'confirm-each') {
          const ok = await confirmer.confirmItem(`Deixar de seguir @${item.username}? (${insp.finalUrl})`);
          if (!ok) {
            return { outcome: 'SKIP', reason: 'recusado pelo usuário' };
          }
        }
        return decision;
      },
      execute: async (bi) => {
        const item = getItem(bi.profileId);
        const before = observed.get(bi.profileId) ?? 'UNKNOWN';
        let after: ObservedRelationship;
        try {
          after = await driver.performUnfollow();
        } catch (error) {
          const shot = await driver.screenshot(`unfollow-failed-${item.username}`);
          return { result: 'FAILED', detail: `erro ao deixar de seguir: ${String(error)}`, ...(shot ? { screenshotPath: shot } : {}) };
        }
        const interpreted = interpretUnfollowResult(before, after);
        if (interpreted.result !== 'CONFIRMED') {
          const shot = await driver.screenshot(`unfollow-ambiguous-${item.username}`);
          return { ...interpreted, ...(shot ? { screenshotPath: shot } : {}) };
        }
        relationships.closeCycle(item.relationshipCycleId, { unfollowReason: interpreted.detail });
        const shot = await driver.screenshot(`unfollow-${item.username}`);
        return { result: 'CONFIRMED', detail: interpreted.detail, ...(shot ? { screenshotPath: shot } : {}) };
      },
    },
  );

  return { mode: options.mode, proposed: items.length, synced, ...summary };
}

async function runManual(
  relationships: RelationshipRepo,
  items: readonly UnfollowItem[],
  driver: UnfollowDriver,
  confirmer: Confirmer,
  options: RunUnfollowOptions,
  now: Date,
): Promise<UnfollowSummary> {
  const summary = zeroSummary('manual', items.length);
  const cap = options.limit > 0 ? options.limit : items.length;

  for (const item of items.slice(0, cap)) {
    const cycle = relationships.findCycleById(item.relationshipCycleId);
    if (!cycle || cycle.unfollowedAt) {
      summary.skipped += 1;
      continue;
    }
    const rel = relationships.findById(cycle.relationshipId);
    const insp = await driver.inspect(item.profileUrl);
    const decision = evaluatePreAction(
      guardContext(insp, cycle, rel?.whitelisted ?? false, rel?.protected ?? false, options, now),
    );
    if (decision.outcome === 'STOP') {
      summary.stopped = true;
      summary.stopReason = decision.reason;
      break;
    }
    if (decision.outcome !== 'PROCEED') {
      if (insp.relationship === 'NOT_FOLLOWING') {
        relationships.closeCycle(cycle.id, { unfollowReason: 'sync: já não seguia' });
        summary.synced += 1;
      }
      summary.skipped += 1;
      continue;
    }
    await confirmer.waitForManual(`Abra @${item.username} e deixe de seguir manualmente. (${insp.finalUrl})`);
    const after = (await driver.inspect(item.profileUrl)).relationship;
    if (after === 'NOT_FOLLOWING') {
      relationships.closeCycle(cycle.id, { unfollowReason: 'manual' });
      summary.confirmed += 1;
    } else {
      summary.skipped += 1;
    }
  }
  return summary;
}

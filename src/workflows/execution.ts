import type { ActionType } from '../domain/states.js';
import { buildIdempotencyKey } from '../domain/idempotency.js';
import type { ActionAttemptRepo } from '../database/repositories/actions.js';
import type { PreActionDecision } from './pre-action.js';

export interface BatchItem {
  readonly profileId: string;
  /** Identificador estável do alvo (username canônico ou id de plataforma). */
  readonly targetEntityId: string;
  readonly campaignId?: string;
  readonly relationshipCycleId?: string;
  readonly planItemId?: string;
  readonly mediaId?: string;
}

export type ExecuteResult = 'CONFIRMED' | 'AMBIGUOUS' | 'FAILED';

export interface BatchHooks {
  readonly evaluate: (item: BatchItem) => Promise<PreActionDecision> | PreActionDecision;
  readonly execute: (
    item: BatchItem,
  ) => Promise<{ result: ExecuteResult; detail?: string; screenshotPath?: string }>;
}

export interface BatchConfig {
  readonly localAccountId: string;
  readonly localAccountUsername: string;
  readonly actionType: ActionType;
  /** Teto de ações reais. Zero = nada é executado (dry-run). */
  readonly limit: number;
  readonly runId?: string;
  /** Callback opcional de progresso, chamado a cada item processado. */
  readonly onProgress?: (progress: BatchProgress) => void;
}

export type BatchOutcome =
  | 'CONFIRMED'
  | 'SKIPPED'
  | 'REVIEW'
  | 'AMBIGUOUS'
  | 'FAILED'
  | 'IDEMPOTENT_SKIP'
  | 'STOP';

export interface BatchProgress {
  readonly processed: number;
  readonly total: number;
  readonly targetEntityId: string;
  readonly outcome: BatchOutcome;
  readonly confirmed: number;
  readonly skipped: number;
}

export interface BatchSummary {
  processed: number;
  proceeded: number;
  confirmed: number;
  skipped: number;
  review: number;
  ambiguous: number;
  failed: number;
  idempotentSkips: number;
  stopped: boolean;
  stopReason: string | null;
}

/**
 * Executa um lote supervisionado item a item, com revalidação pré-ação e
 * ciclo de vida auditável. Fecha o lote em resultado ambíguo, falha, parada de
 * segurança ou ao atingir o limite. Idempotente: ações já confirmadas são puladas.
 */
export async function runActionBatch(
  actions: ActionAttemptRepo,
  items: readonly BatchItem[],
  config: BatchConfig,
  hooks: BatchHooks,
): Promise<BatchSummary> {
  const summary: BatchSummary = {
    processed: 0,
    proceeded: 0,
    confirmed: 0,
    skipped: 0,
    review: 0,
    ambiguous: 0,
    failed: 0,
    idempotentSkips: 0,
    stopped: false,
    stopReason: null,
  };

  const emit = (progressItem: BatchItem, outcome: BatchOutcome): void => {
    config.onProgress?.({
      processed: summary.processed,
      total: items.length,
      targetEntityId: progressItem.targetEntityId,
      outcome,
      confirmed: summary.confirmed,
      skipped: summary.skipped,
    });
  };

  for (const item of items) {
    // Teto de ações reais: uma vez atingido, encerra a fatia sem avaliar (nem
    // confirmar) mais itens.
    if (summary.proceeded >= config.limit) {
      summary.stopped = true;
      summary.stopReason = 'limite de ações reais atingido';
      break;
    }

    const key = buildIdempotencyKey({
      localAccount: config.localAccountUsername,
      actionType: config.actionType,
      targetEntityId: item.targetEntityId,
      ...(item.relationshipCycleId ? { relationshipCycleId: item.relationshipCycleId } : {}),
      ...(item.planItemId ? { planItemId: item.planItemId } : {}),
      ...(item.mediaId ? { mediaId: item.mediaId } : {}),
    });

    const existing = actions.findByIdempotencyKey(key);
    if (existing) {
      if (existing.state === 'CONFIRMED') {
        summary.idempotentSkips += 1;
        summary.skipped += 1;
        summary.processed += 1;
        emit(item, 'IDEMPOTENT_SKIP');
        continue;
      }
      if (existing.state === 'PENDING' || existing.state === 'AMBIGUOUS') {
        summary.stopped = true;
        summary.stopReason = 'ação anterior não confirmada; reconcilie antes de prosseguir';
        emit(item, 'STOP');
        break;
      }
      if (existing.state === 'FAILED' || existing.state === 'SKIPPED') {
        // Sem repetição automática.
        summary.skipped += 1;
        summary.processed += 1;
        emit(item, 'SKIPPED');
        continue;
      }
    }

    const decision = await hooks.evaluate(item);
    if (decision.outcome === 'STOP') {
      summary.stopped = true;
      summary.stopReason = decision.reason;
      emit(item, 'STOP');
      break;
    }

    if (decision.outcome === 'SKIP' || decision.outcome === 'REVIEW') {
      const prep = actions.prepare(basePrepare(config, item, key));
      const detail = decision.outcome === 'REVIEW' ? `NEEDS_REVIEW: ${decision.reason}` : decision.reason;
      actions.transition(prep.attempt.id, 'SKIPPED', { result: detail });
      if (decision.outcome === 'REVIEW') {
        summary.review += 1;
      } else {
        summary.skipped += 1;
      }
      summary.processed += 1;
      emit(item, decision.outcome === 'REVIEW' ? 'REVIEW' : 'SKIPPED');
      continue;
    }

    // PROCEED
    const prep = actions.prepare(basePrepare(config, item, key));
    actions.transition(prep.attempt.id, 'PENDING');
    summary.proceeded += 1;

    const res = await hooks.execute(item);
    actions.transition(prep.attempt.id, res.result, {
      ...(res.detail ? { result: res.detail } : {}),
      ...(res.screenshotPath ? { screenshotPath: res.screenshotPath } : {}),
    });
    summary.processed += 1;

    if (res.result === 'CONFIRMED') {
      summary.confirmed += 1;
      emit(item, 'CONFIRMED');
      continue;
    }
    if (res.result === 'AMBIGUOUS') {
      summary.ambiguous += 1;
      summary.stopped = true;
      summary.stopReason = 'resultado ambíguo; revisão manual necessária';
      emit(item, 'AMBIGUOUS');
      break;
    }
    summary.failed += 1;
    summary.stopped = true;
    summary.stopReason = 'falha na ação; parada sem repetição automática';
    emit(item, 'FAILED');
    break;
  }

  return summary;
}

function basePrepare(config: BatchConfig, item: BatchItem, key: string) {
  return {
    localAccountId: config.localAccountId,
    profileId: item.profileId,
    actionType: config.actionType,
    idempotencyKey: key,
    ...(config.runId ? { runId: config.runId } : {}),
    ...(item.campaignId ? { campaignId: item.campaignId } : {}),
    ...(item.relationshipCycleId ? { relationshipCycleId: item.relationshipCycleId } : {}),
    ...(item.planItemId ? { planItemId: item.planItemId } : {}),
    ...(item.mediaId ? { mediaId: item.mediaId } : {}),
  };
}

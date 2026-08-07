import { createHash } from 'node:crypto';
import type { ActionType } from './states.js';

/**
 * Entrada para derivar uma chave de idempotência estável.
 *
 * A chave NÃO usa timestamp nem username isolado: ela identifica a ação lógica
 * de forma que uma repetição da mesma ação produza a mesma chave (permitindo
 * detectar duplicação), enquanto ações logicamente diferentes divergem.
 */
export interface IdempotencyInput {
  /** Conta local do Instagram que executa a ação. */
  readonly localAccount: string;
  readonly actionType: ActionType;
  /** Identificador estável do alvo (id da plataforma ou username canônico). */
  readonly targetEntityId: string;
  /** Ciclo de relacionamento, quando aplicável (follow/unfollow). */
  readonly relationshipCycleId?: string;
  /** Item do plano, quando a ação vem de um plano imutável. */
  readonly planItemId?: string;
  /** Mídia estável (shortcode) para curtidas. */
  readonly mediaId?: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = normalize(value);
  if (normalized.length === 0) {
    throw new Error(`Campo obrigatório vazio para idempotency key: ${field}`);
  }
  return normalized;
}

/**
 * Deriva uma chave de idempotência determinística (sha256 hex).
 */
export function buildIdempotencyKey(input: IdempotencyInput): string {
  const localAccount = requireNonEmpty(input.localAccount, 'localAccount');
  const actionType = requireNonEmpty(input.actionType, 'actionType');
  const targetEntityId = requireNonEmpty(input.targetEntityId, 'targetEntityId');

  if (input.actionType === 'LIKE_POST' && !input.mediaId) {
    throw new Error('LIKE_POST exige mediaId para a idempotency key.');
  }

  const canonical = [
    localAccount,
    actionType,
    targetEntityId,
    input.relationshipCycleId ? normalize(input.relationshipCycleId) : '',
    input.planItemId ? normalize(input.planItemId) : '',
    input.mediaId ? normalize(input.mediaId) : '',
  ].join('|');

  return createHash('sha256').update(canonical).digest('hex');
}

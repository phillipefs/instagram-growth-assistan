import type { SafetyState } from '../domain/states.js';
import type { SafetyTrigger } from '../safety/safety-monitor.js';
import type { ObservedRelationship } from '../browser/profile-detector.js';

export type ActionIntent = 'FOLLOW' | 'UNFOLLOW' | 'LIKE_POST';

export type PreActionOutcome = 'PROCEED' | 'SKIP' | 'REVIEW' | 'STOP';

export interface PreActionContext {
  readonly intent: ActionIntent;
  readonly safetyState: SafetyState;
  /** Deve parar por divergência de conta ativa. */
  readonly accountShouldStop: boolean;
  /** Estado do plano imutável no momento da ação. */
  readonly planFrozen: boolean;
  /** Relacionamento observado na página, quando disponível. */
  readonly observedRelationship?: ObservedRelationship;
  readonly whitelisted?: boolean;
  readonly protected?: boolean;
  /** Verdadeiro apenas se o follow foi comprovadamente feito pela ferramenta. */
  readonly followedByTool?: boolean;
  /** Preservar quem seguiu de volta (política de unfollow). */
  readonly preserveFollowBacks?: boolean;
  readonly followBack?: 'UNKNOWN' | 'YES' | 'NO';
}

export interface PreActionDecision {
  readonly outcome: PreActionOutcome;
  readonly reason: string;
  readonly safetyTrigger?: SafetyTrigger;
}

/**
 * Guarda executada imediatamente antes de cada item, revalidando segurança,
 * conta ativa, validade do plano e o estado esperado do relacionamento.
 *
 * Falha fechada: em dúvida, não age. Divergências param o lote.
 */
export function evaluatePreAction(ctx: PreActionContext): PreActionDecision {
  if (ctx.safetyState !== 'SAFE') {
    return { outcome: 'STOP', reason: `estado de segurança ${ctx.safetyState}`, safetyTrigger: 'UNKNOWN_INTERFACE' };
  }
  if (ctx.accountShouldStop) {
    return { outcome: 'STOP', reason: 'conta ativa divergente', safetyTrigger: 'ACCOUNT_CHANGED' };
  }
  if (!ctx.planFrozen) {
    return { outcome: 'STOP', reason: 'plano não está congelado (FROZEN)' };
  }

  if (ctx.intent === 'FOLLOW') {
    return evaluateFollow(ctx);
  }
  if (ctx.intent === 'UNFOLLOW') {
    return evaluateUnfollow(ctx);
  }
  return evaluateLike(ctx);
}

function evaluateFollow(ctx: PreActionContext): PreActionDecision {
  switch (ctx.observedRelationship) {
    case 'FOLLOWING':
      return { outcome: 'SKIP', reason: 'já seguindo' };
    case 'FOLLOW_REQUESTED':
      return { outcome: 'SKIP', reason: 'solicitação já enviada' };
    case 'UNKNOWN':
      return { outcome: 'REVIEW', reason: 'relacionamento desconhecido' };
    case 'NOT_FOLLOWING':
    case undefined:
      return { outcome: 'PROCEED', reason: 'apto a seguir' };
    default:
      return { outcome: 'REVIEW', reason: 'relacionamento não reconhecido' };
  }
}

function evaluateUnfollow(ctx: PreActionContext): PreActionDecision {
  if (ctx.whitelisted) {
    return { outcome: 'SKIP', reason: 'whitelist' };
  }
  if (ctx.protected) {
    return { outcome: 'SKIP', reason: 'protegido' };
  }
  if (ctx.followedByTool === false) {
    return { outcome: 'SKIP', reason: 'sem histórico comprovado da ferramenta' };
  }
  if (ctx.preserveFollowBacks && ctx.followBack !== 'NO') {
    return { outcome: 'SKIP', reason: `follow-back ${ctx.followBack ?? 'UNKNOWN'} preservado` };
  }
  switch (ctx.observedRelationship) {
    case 'NOT_FOLLOWING':
      return { outcome: 'SKIP', reason: 'já não está seguindo (sincronizar)' };
    case 'UNKNOWN':
      return { outcome: 'REVIEW', reason: 'relacionamento desconhecido' };
    default:
      return { outcome: 'PROCEED', reason: 'apto a deixar de seguir' };
  }
}

function evaluateLike(ctx: PreActionContext): PreActionDecision {
  if (ctx.observedRelationship === 'UNKNOWN') {
    return { outcome: 'REVIEW', reason: 'estado desconhecido' };
  }
  return { outcome: 'PROCEED', reason: 'apto a curtir' };
}

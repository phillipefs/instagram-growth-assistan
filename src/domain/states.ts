/**
 * Máquinas de estado do domínio, deliberadamente separadas.
 *
 * Cada conceito tem seu próprio ciclo de vida. Misturar aprovação de campanha,
 * estado de relacionamento, resultado de ação e planejamento em uma única
 * máquina foi identificado como um risco e é evitado aqui.
 */

/** Estado do candidato dentro de uma campanha. */
export const CAMPAIGN_CANDIDATE_STATES = [
  'DISCOVERED',
  'FILTERED',
  'APPROVED',
  'REJECTED',
  'SKIPPED',
  'NEEDS_REVIEW',
] as const;
export type CampaignCandidateState = (typeof CAMPAIGN_CANDIDATE_STATES)[number];

/** Estado observado/registrado do relacionamento com um perfil. */
export const RELATIONSHIP_STATES = [
  'NOT_FOLLOWING',
  'FOLLOW_REQUESTED',
  'FOLLOWING',
  'UNFOLLOWED',
] as const;
export type RelationshipState = (typeof RELATIONSHIP_STATES)[number];

/** Como o relacionamento atual foi originado. */
export const RELATIONSHIP_ORIGINS = [
  'TOOL_CLICK',
  'USER_CLICK_OBSERVED',
  'IMPORTED',
  'PREEXISTING',
] as const;
export type RelationshipOrigin = (typeof RELATIONSHIP_ORIGINS)[number];

/** Situação do follow-back de um perfil em relação à conta local. */
export const FOLLOW_BACK_STATES = ['UNKNOWN', 'YES', 'NO'] as const;
export type FollowBackState = (typeof FOLLOW_BACK_STATES)[number];

/** Ciclo de vida de uma tentativa de ação. */
export const ACTION_STATES = [
  'PREPARED',
  'PENDING',
  'CONFIRMED',
  'AMBIGUOUS',
  'FAILED',
  'SKIPPED',
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

/** Tipos de ação auditáveis. */
export const ACTION_TYPES = [
  'COLLECT',
  'INSPECT',
  'FOLLOW',
  'CANCEL_FOLLOW_REQUEST',
  'LIKE_POST',
  'UNFOLLOW',
  'SKIP',
  'PROTECT',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Ciclo de vida de um plano imutável (follow ou unfollow). */
export const PLAN_STATES = ['DRAFT', 'FROZEN', 'INVALIDATED', 'COMPLETED'] as const;
export type PlanState = (typeof PLAN_STATES)[number];

/** Ciclo de vida de uma execução (run). */
export const RUN_STATES = [
  'CREATED',
  'RUNNING',
  'PAUSED',
  'STOPPED',
  'COMPLETED',
  'FAILED',
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Estados do monitor de segurança. Nenhuma ação ocorre fora de `SAFE`. */
export const SAFETY_STATES = [
  'SAFE',
  'PAUSED',
  'SUSPENDED',
  'NEEDS_MANUAL_REVIEW',
  'SESSION_EXPIRED',
  'ACCOUNT_CHANGED',
  'CAPTCHA_DETECTED',
  'CHALLENGE_DETECTED',
  'WARNING_DETECTED',
  'UNKNOWN_INTERFACE',
] as const;
export type SafetyState = (typeof SAFETY_STATES)[number];

/**
 * Somente relacionamentos comprovadamente iniciados pela ferramenta podem
 * entrar no planejador automático de unfollow.
 */
export function isOriginEligibleForAutoUnfollow(origin: RelationshipOrigin): boolean {
  return origin === 'TOOL_CLICK';
}

/**
 * Decide se o follow-back deve bloquear a inclusão no plano de unfollow.
 *
 * Quando a política é preservar quem seguiu de volta, apenas o estado `NO`
 * é elegível. `YES` e `UNKNOWN` falham de forma fechada.
 */
export function isFollowBackBlockingUnfollow(
  followBack: FollowBackState,
  preserveFollowBacks: boolean,
): boolean {
  if (!preserveFollowBacks) {
    return false;
  }
  return followBack !== 'NO';
}

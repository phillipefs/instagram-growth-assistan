import type { ActionAttemptRepo } from '../database/repositories/actions.js';
import type { ActionType } from '../domain/states.js';
import { startOfUtcDay } from '../domain/cohort.js';

export interface DailyCapResult {
  readonly effectiveLimit: number;
  readonly alreadyToday: number;
  readonly cap: number;
  readonly capReached: boolean;
}

/** Início do dia UTC atual em ISO (`YYYY-MM-DDT00:00:00.000Z`). */
export function utcDayStartIso(now: Date): string {
  return startOfUtcDay(now.toISOString().slice(0, 10));
}

/**
 * Aplica o teto operacional diário a um limite por invocação. É um teto contra
 * excesso acidental, não um "limite seguro" da plataforma. `cap <= 0` desliga o
 * teto (o limite por invocação continua valendo). Nunca retorna limite negativo.
 */
export function applyDailyCap(
  actions: ActionAttemptRepo,
  localAccountId: string,
  actionType: ActionType,
  requestedLimit: number,
  cap: number,
  now: Date = new Date(),
): DailyCapResult {
  if (cap <= 0) {
    return { effectiveLimit: requestedLimit, alreadyToday: 0, cap: 0, capReached: false };
  }
  const alreadyToday = actions.countRealActionsSince(
    localAccountId,
    actionType,
    utcDayStartIso(now),
  );
  const remaining = Math.max(0, cap - alreadyToday);
  return {
    effectiveLimit: Math.min(requestedLimit, remaining),
    alreadyToday,
    cap,
    capReached: remaining <= 0,
  };
}

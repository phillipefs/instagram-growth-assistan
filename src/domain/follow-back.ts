import type { FollowBackState } from './states.js';

/**
 * Frescor e elegibilidade de observações de follow-back para o unfollow.
 */

/** Verdadeiro se a observação foi feita dentro da validade. */
export function isObservationFresh(
  checkedAt: string | null,
  validityDays: number,
  now: Date = new Date(),
): boolean {
  if (!checkedAt) {
    return false;
  }
  const ageDays = (now.getTime() - new Date(checkedAt).getTime()) / 86_400_000;
  return ageDays >= 0 && ageDays <= validityDays;
}

/**
 * Decide se um relacionamento é elegível ao unfollow quanto ao follow-back.
 *
 * Quando a política é preservar quem seguiu de volta, apenas `NO` observado e
 * ainda fresco é elegível. `YES`, `UNKNOWN` e observações vencidas falham fechado.
 */
export function isEligibleForUnfollowByFollowBack(params: {
  value: FollowBackState;
  checkedAt: string | null;
  validityDays: number;
  preserveFollowBacks: boolean;
  now?: Date;
}): boolean {
  if (!params.preserveFollowBacks) {
    return true;
  }
  if (params.value !== 'NO') {
    return false;
  }
  return isObservationFresh(params.checkedAt, params.validityDays, params.now ?? new Date());
}

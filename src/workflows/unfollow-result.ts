import type { ObservedRelationship } from '../browser/profile-detector.js';
import type { ExecuteResult } from './execution.js';

/**
 * Interpreta o resultado de uma saída a partir do relacionamento observado
 * depois da ação. Só `NOT_FOLLOWING` confirma; o resto é ambíguo e não deve
 * ser repetido automaticamente.
 */
export function interpretUnfollowResult(
  before: ObservedRelationship,
  after: ObservedRelationship,
): { result: ExecuteResult; detail: string } {
  if (after === 'NOT_FOLLOWING') {
    const kind = before === 'FOLLOW_REQUESTED' ? 'CANCEL_FOLLOW_REQUEST' : 'UNFOLLOWED';
    return { result: 'CONFIRMED', detail: kind };
  }
  return { result: 'AMBIGUOUS', detail: `sem confirmação visual (antes=${before}, depois=${after})` };
}

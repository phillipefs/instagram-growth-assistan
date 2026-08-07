import type { ObservedRelationship } from '../browser/profile-detector.js';
import type { ExecuteResult } from './execution.js';

/**
 * Interpreta o resultado de um follow a partir do relacionamento observado
 * antes e depois do clique.
 *
 * `FOLLOWING`/`FOLLOW_REQUESTED` confirmam; qualquer outra coisa é ambígua e não
 * deve ser repetida automaticamente.
 */
export function interpretFollowResult(
  before: ObservedRelationship,
  after: ObservedRelationship,
): { result: ExecuteResult; detail: string } {
  if (after === 'FOLLOWING') {
    return { result: 'CONFIRMED', detail: 'FOLLOWED' };
  }
  if (after === 'FOLLOW_REQUESTED') {
    return { result: 'CONFIRMED', detail: 'FOLLOW_REQUESTED' };
  }
  return { result: 'AMBIGUOUS', detail: `sem confirmação visual (antes=${before}, depois=${after})` };
}

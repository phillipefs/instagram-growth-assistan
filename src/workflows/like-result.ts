import type { ExecuteResult } from './execution.js';

export type LikeState = 'LIKED' | 'NOT_LIKED' | 'UNKNOWN';

/**
 * Interpreta o resultado de uma curtida a partir do estado observado após o
 * clique. Só `LIKED` confirma; o resto é ambíguo e não deve repetir.
 */
export function interpretLikeResult(after: LikeState): { result: ExecuteResult; detail: string } {
  if (after === 'LIKED') {
    return { result: 'CONFIRMED', detail: 'LIKED' };
  }
  return { result: 'AMBIGUOUS', detail: `sem confirmação visual (estado=${after})` };
}

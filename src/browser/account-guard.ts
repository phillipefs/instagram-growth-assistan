import { canonicalUsername } from '../database/util.js';

export type AccountMatch = 'match' | 'mismatch' | 'unknown';

export interface AccountComparison {
  readonly match: AccountMatch;
  readonly configured: string | null;
  readonly active: string | null;
  /** Verdadeiro quando não é seguro prosseguir (falha fechada). */
  readonly shouldStop: boolean;
}

/**
 * Compara a conta configurada com a conta ativa detectada.
 *
 * Falha fechada: se a conta configurada existe mas a ativa não foi confirmada,
 * ou se diverge, o resultado exige parada.
 */
export function compareActiveAccount(
  configured: string | null,
  active: string | null,
): AccountComparison {
  if (!configured) {
    // Sem conta configurada não há o que comparar; a checagem ocorre no workflow.
    return { match: 'unknown', configured, active, shouldStop: false };
  }
  if (!active) {
    return { match: 'unknown', configured, active, shouldStop: true };
  }
  const same = canonicalUsername(configured) === canonicalUsername(active);
  return {
    match: same ? 'match' : 'mismatch',
    configured,
    active,
    shouldStop: !same,
  };
}

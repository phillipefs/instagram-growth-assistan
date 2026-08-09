import type { ActionState } from './states.js';

const TRANSITIONS: Record<ActionState, readonly ActionState[]> = {
  PREPARED: ['PENDING', 'SKIPPED', 'FAILED'],
  PENDING: ['CONFIRMED', 'AMBIGUOUS', 'FAILED', 'SKIPPED'],
  CONFIRMED: [],
  AMBIGUOUS: [],
  FAILED: [],
  SKIPPED: [],
};

const TERMINAL_STATES: readonly ActionState[] = ['CONFIRMED', 'AMBIGUOUS', 'FAILED', 'SKIPPED'];

export function isTerminalActionState(state: ActionState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransitionAction(from: ActionState, to: ActionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidActionTransitionError extends Error {
  constructor(from: ActionState, to: ActionState) {
    super(`Transição de ação inválida: ${from} → ${to}`);
    this.name = 'InvalidActionTransitionError';
  }
}

export function assertActionTransition(from: ActionState, to: ActionState): void {
  if (!canTransitionAction(from, to)) {
    throw new InvalidActionTransitionError(from, to);
  }
}

/**
 * Pequena máquina de estados para uma tentativa de ação.
 *
 * A intenção (`PREPARED`/`PENDING`) é registrada antes da interação; o resultado
 * observado (`CONFIRMED`/`AMBIGUOUS`/`FAILED`/`SKIPPED`) é registrado depois.
 * `PENDING → SKIPPED` representa a guarda final que abortou antes do clique.
 */
export class ActionAttempt {
  private current: ActionState;

  constructor(initial: ActionState = 'PREPARED') {
    this.current = initial;
  }

  get state(): ActionState {
    return this.current;
  }

  get isTerminal(): boolean {
    return isTerminalActionState(this.current);
  }

  transition(to: ActionState): ActionState {
    assertActionTransition(this.current, to);
    this.current = to;
    return this.current;
  }
}

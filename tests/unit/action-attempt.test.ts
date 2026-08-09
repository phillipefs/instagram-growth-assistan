import { describe, expect, it } from 'vitest';
import {
  ActionAttempt,
  InvalidActionTransitionError,
  canTransitionAction,
  isTerminalActionState,
} from '../../src/domain/action-attempt.js';

describe('máquina de tentativa de ação', () => {
  it('segue o caminho feliz PREPARED → PENDING → CONFIRMED', () => {
    const attempt = new ActionAttempt();
    expect(attempt.state).toBe('PREPARED');
    attempt.transition('PENDING');
    attempt.transition('CONFIRMED');
    expect(attempt.state).toBe('CONFIRMED');
    expect(attempt.isTerminal).toBe(true);
  });

  it('permite PREPARED → SKIPPED sem agir', () => {
    const attempt = new ActionAttempt();
    attempt.transition('SKIPPED');
    expect(attempt.isTerminal).toBe(true);
  });

  it('marca resultado ambíguo a partir de PENDING', () => {
    const attempt = new ActionAttempt('PENDING');
    attempt.transition('AMBIGUOUS');
    expect(attempt.state).toBe('AMBIGUOUS');
  });

  it('permite PENDING → SKIPPED quando a guarda final impede o clique', () => {
    const attempt = new ActionAttempt('PENDING');
    attempt.transition('SKIPPED');
    expect(attempt.isTerminal).toBe(true);
  });

  it('rejeita transições inválidas', () => {
    const attempt = new ActionAttempt();
    expect(() => attempt.transition('CONFIRMED')).toThrow(InvalidActionTransitionError);
  });

  it('não sai de estados terminais', () => {
    expect(canTransitionAction('CONFIRMED', 'PENDING')).toBe(false);
    expect(canTransitionAction('FAILED', 'PENDING')).toBe(false);
    expect(isTerminalActionState('AMBIGUOUS')).toBe(true);
    expect(isTerminalActionState('PENDING')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { compareActiveAccount } from '../../src/browser/account-guard.js';

describe('compareActiveAccount', () => {
  it('confirma quando as contas coincidem (case/@ insensível)', () => {
    const result = compareActiveAccount('@Minha_Conta', 'minha_conta');
    expect(result.match).toBe('match');
    expect(result.shouldStop).toBe(false);
  });

  it('exige parada quando as contas divergem', () => {
    const result = compareActiveAccount('minha_conta', 'outra_conta');
    expect(result.match).toBe('mismatch');
    expect(result.shouldStop).toBe(true);
  });

  it('falha fechada quando a conta ativa é desconhecida', () => {
    const result = compareActiveAccount('minha_conta', null);
    expect(result.match).toBe('unknown');
    expect(result.shouldStop).toBe(true);
  });

  it('não bloqueia quando não há conta configurada', () => {
    const result = compareActiveAccount(null, 'qualquer');
    expect(result.shouldStop).toBe(false);
  });
});

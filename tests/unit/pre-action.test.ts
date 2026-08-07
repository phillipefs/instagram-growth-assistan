import { describe, expect, it } from 'vitest';
import { evaluatePreAction, type PreActionContext } from '../../src/workflows/pre-action.js';

function ctx(overrides: Partial<PreActionContext>): PreActionContext {
  return {
    intent: 'FOLLOW',
    safetyState: 'SAFE',
    accountShouldStop: false,
    planFrozen: true,
    ...overrides,
  };
}

describe('evaluatePreAction — comum', () => {
  it('para fora de SAFE', () => {
    expect(evaluatePreAction(ctx({ safetyState: 'CAPTCHA_DETECTED' })).outcome).toBe('STOP');
  });
  it('para em conta divergente', () => {
    expect(evaluatePreAction(ctx({ accountShouldStop: true })).outcome).toBe('STOP');
  });
  it('para se o plano não está congelado', () => {
    expect(evaluatePreAction(ctx({ planFrozen: false })).outcome).toBe('STOP');
  });
});

describe('evaluatePreAction — FOLLOW', () => {
  it('procede quando não segue', () => {
    expect(evaluatePreAction(ctx({ observedRelationship: 'NOT_FOLLOWING' })).outcome).toBe('PROCEED');
  });
  it('pula quando já segue ou solicitou', () => {
    expect(evaluatePreAction(ctx({ observedRelationship: 'FOLLOWING' })).outcome).toBe('SKIP');
    expect(evaluatePreAction(ctx({ observedRelationship: 'FOLLOW_REQUESTED' })).outcome).toBe('SKIP');
  });
  it('revisa quando o relacionamento é desconhecido', () => {
    expect(evaluatePreAction(ctx({ observedRelationship: 'UNKNOWN' })).outcome).toBe('REVIEW');
  });
});

describe('evaluatePreAction — UNFOLLOW', () => {
  const base = { intent: 'UNFOLLOW' as const, followedByTool: true, observedRelationship: 'FOLLOWING' as const };

  it('procede com histórico da ferramenta e follow-back NO', () => {
    const d = evaluatePreAction(ctx({ ...base, preserveFollowBacks: true, followBack: 'NO' }));
    expect(d.outcome).toBe('PROCEED');
  });
  it('pula whitelist e protegidos', () => {
    expect(evaluatePreAction(ctx({ ...base, whitelisted: true })).outcome).toBe('SKIP');
    expect(evaluatePreAction(ctx({ ...base, protected: true })).outcome).toBe('SKIP');
  });
  it('pula sem histórico comprovado da ferramenta', () => {
    expect(evaluatePreAction(ctx({ ...base, followedByTool: false })).outcome).toBe('SKIP');
  });
  it('preserva follow-back YES/UNKNOWN', () => {
    expect(evaluatePreAction(ctx({ ...base, preserveFollowBacks: true, followBack: 'YES' })).outcome).toBe('SKIP');
    expect(evaluatePreAction(ctx({ ...base, preserveFollowBacks: true, followBack: 'UNKNOWN' })).outcome).toBe('SKIP');
  });
});

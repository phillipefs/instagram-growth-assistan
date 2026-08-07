import { describe, expect, it } from 'vitest';
import { assessSession, type SessionSignals } from '../../src/browser/session-detector.js';

function signals(overrides: Partial<SessionSignals> = {}): SessionSignals {
  return {
    url: 'https://www.instagram.com/',
    host: 'www.instagram.com',
    isUnexpectedDomain: false,
    onLoginPage: false,
    captchaPresent: false,
    challengePresent: false,
    warningPresent: false,
    activeUsername: null,
    ...overrides,
  };
}

describe('assessSession', () => {
  it('detecta CAPTCHA com prioridade máxima', () => {
    const result = assessSession(signals({ captchaPresent: true, activeUsername: 'x' }));
    expect(result.safetyState).toBe('CAPTCHA_DETECTED');
    expect(result.sessionStatus).toBe('unknown');
  });

  it('detecta desafio/checkpoint', () => {
    expect(assessSession(signals({ challengePresent: true })).safetyState).toBe('CHALLENGE_DETECTED');
  });

  it('detecta aviso de atividade', () => {
    expect(assessSession(signals({ warningPresent: true })).safetyState).toBe('WARNING_DETECTED');
  });

  it('trata domínio inesperado como interface desconhecida', () => {
    const result = assessSession(signals({ isUnexpectedDomain: true, host: 'example.com' }));
    expect(result.safetyState).toBe('UNKNOWN_INTERFACE');
  });

  it('classifica página de login como não autenticada e segura', () => {
    const result = assessSession(signals({ onLoginPage: true }));
    expect(result.sessionStatus).toBe('unauthenticated');
    expect(result.safetyState).toBe('SAFE');
  });

  it('classifica login com indício de expiração como expirada', () => {
    const result = assessSession(signals({ onLoginPage: true, sessionExpiredHint: true }));
    expect(result.sessionStatus).toBe('expired');
    expect(result.safetyState).toBe('SESSION_EXPIRED');
  });

  it('classifica sessão autenticada quando há conta ativa', () => {
    const result = assessSession(signals({ activeUsername: 'minha_conta' }));
    expect(result.sessionStatus).toBe('authenticated');
    expect(result.activeAccount).toBe('minha_conta');
    expect(result.safetyState).toBe('SAFE');
  });

  it('falha fechada quando nada é reconhecível', () => {
    const result = assessSession(signals());
    expect(result.sessionStatus).toBe('unknown');
    expect(result.safetyState).toBe('UNKNOWN_INTERFACE');
  });
});

import { describe, expect, it } from 'vitest';
import { SafetyMonitor, SafetyBlockedError } from '../../src/safety/safety-monitor.js';

const fixedClock = () => new Date('2026-08-06T00:00:00.000Z');

describe('SafetyMonitor', () => {
  it('começa em SAFE e permite ação', () => {
    const monitor = new SafetyMonitor({ now: fixedClock });
    expect(monitor.isSafe()).toBe(true);
    expect(() => monitor.assertSafe()).not.toThrow();
  });

  it('mapeia gatilhos para estados bloqueantes e registra o motivo', () => {
    const monitor = new SafetyMonitor({ now: fixedClock });
    expect(monitor.report({ trigger: 'CAPTCHA' })).toBe('CAPTCHA_DETECTED');
    expect(monitor.report({ trigger: 'ACCOUNT_CHANGED', detail: 'conta X' })).toBe(
      'ACCOUNT_CHANGED',
    );
    expect(monitor.getState()).toBe('ACCOUNT_CHANGED');
    expect(monitor.reason()?.detail).toBe('conta X');
    expect(monitor.history()).toHaveLength(2);
  });

  it('bloqueia ações fora de SAFE', () => {
    const monitor = new SafetyMonitor({ now: fixedClock });
    monitor.report({ trigger: 'CHALLENGE', detail: 'checkpoint' });
    expect(() => monitor.assertSafe()).toThrow(SafetyBlockedError);
  });

  it('não retoma automaticamente; só resume explícito volta para SAFE', () => {
    const monitor = new SafetyMonitor({ now: fixedClock });
    monitor.report({ trigger: 'WARNING' });
    expect(monitor.isSafe()).toBe(false);
    monitor.resume();
    expect(monitor.isSafe()).toBe(true);
    expect(() => monitor.assertSafe()).not.toThrow();
  });

  it('trata domínio inesperado como interface desconhecida', () => {
    const monitor = new SafetyMonitor({ now: fixedClock });
    expect(monitor.report({ trigger: 'UNEXPECTED_DOMAIN' })).toBe('UNKNOWN_INTERFACE');
  });
});

import { describe, expect, it } from 'vitest';
import {
  InMemoryLeaseStore,
  LeaseHeldError,
  LeaseManager,
  LeaseNotHeldError,
} from '../../src/safety/lease.js';

function makeManager(startAt: number, ttlMs = 1000) {
  let clock = startAt;
  const store = new InMemoryLeaseStore();
  const manager = new LeaseManager(store, { ttlMs, now: () => clock });
  return {
    manager,
    store,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('LeaseManager', () => {
  it('adquire e renova o lease do mesmo holder', () => {
    const { manager, advance } = makeManager(0);
    manager.acquire('conta', 'run-1');
    advance(500);
    const renewed = manager.heartbeat('conta', 'run-1');
    expect(renewed.expiresAt).toBe(1500);
  });

  it('impede segunda execução ativa na mesma conta', () => {
    const { manager } = makeManager(0);
    manager.acquire('conta', 'run-1');
    expect(() => manager.acquire('conta', 'run-2')).toThrow(LeaseHeldError);
  });

  it('permite assumir um lease órfão expirado', () => {
    const { manager, advance } = makeManager(0);
    manager.acquire('conta', 'run-1');
    advance(2000);
    const lease = manager.acquire('conta', 'run-2');
    expect(lease.holder).toBe('run-2');
  });

  it('rejeita heartbeat de quem não detém o lease', () => {
    const { manager } = makeManager(0);
    manager.acquire('conta', 'run-1');
    expect(() => manager.heartbeat('conta', 'run-2')).toThrow(LeaseNotHeldError);
  });

  it('libera o lease do holder atual', () => {
    const { manager, store } = makeManager(0);
    manager.acquire('conta', 'run-1');
    manager.release('conta', 'run-1');
    expect(store.get('conta')).toBeUndefined();
  });

  it('impede liberação por outro holder com lease ativo', () => {
    const { manager } = makeManager(0);
    manager.acquire('conta', 'run-1');
    expect(() => manager.release('conta', 'run-2')).toThrow(LeaseNotHeldError);
  });
});

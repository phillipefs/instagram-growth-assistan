/**
 * Modelo de lease para garantir uma única execução ativa por conta local.
 *
 * A persistência real virá com o banco de dados; aqui ficam o contrato e uma
 * implementação em memória, além do gerenciador com lógica de expiração,
 * heartbeat e recuperação de lease órfão (relógio injetável para testes).
 */

export interface Lease {
  readonly key: string;
  readonly holder: string;
  readonly acquiredAt: number;
  readonly heartbeatAt: number;
  readonly expiresAt: number;
}

export interface LeaseStore {
  get(key: string): Lease | undefined;
  set(lease: Lease): void;
  delete(key: string): void;
}

export class InMemoryLeaseStore implements LeaseStore {
  private readonly leases = new Map<string, Lease>();

  get(key: string): Lease | undefined {
    return this.leases.get(key);
  }

  set(lease: Lease): void {
    this.leases.set(lease.key, lease);
  }

  delete(key: string): void {
    this.leases.delete(key);
  }
}

export class LeaseHeldError extends Error {
  readonly holder: string;

  constructor(key: string, holder: string) {
    super(`Já existe uma execução ativa para "${key}" (holder ${holder}).`);
    this.name = 'LeaseHeldError';
    this.holder = holder;
  }
}

export class LeaseNotHeldError extends Error {
  constructor(key: string, holder: string) {
    super(`O holder "${holder}" não detém o lease de "${key}".`);
    this.name = 'LeaseNotHeldError';
  }
}

export interface LeaseManagerOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export class LeaseManager {
  private readonly store: LeaseStore;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(store: LeaseStore, options: LeaseManagerOptions = {}) {
    this.store = store;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  private isExpired(lease: Lease, at: number): boolean {
    return lease.expiresAt <= at;
  }

  /**
   * Adquire o lease. Um lease ativo de outro holder impede a aquisição.
   * Um lease expirado (órfão) pode ser assumido.
   */
  acquire(key: string, holder: string): Lease {
    const at = this.now();
    const existing = this.store.get(key);
    if (existing && existing.holder !== holder && !this.isExpired(existing, at)) {
      throw new LeaseHeldError(key, existing.holder);
    }
    const lease: Lease = {
      key,
      holder,
      acquiredAt: at,
      heartbeatAt: at,
      expiresAt: at + this.ttlMs,
    };
    this.store.set(lease);
    return lease;
  }

  /** Renova o lease do holder atual. */
  heartbeat(key: string, holder: string): Lease {
    const at = this.now();
    const existing = this.store.get(key);
    if (!existing || existing.holder !== holder || this.isExpired(existing, at)) {
      throw new LeaseNotHeldError(key, holder);
    }
    const lease: Lease = { ...existing, heartbeatAt: at, expiresAt: at + this.ttlMs };
    this.store.set(lease);
    return lease;
  }

  /** Libera o lease. Apenas o holder atual pode liberar. */
  release(key: string, holder: string): void {
    const existing = this.store.get(key);
    if (existing && existing.holder !== holder && !this.isExpired(existing, this.now())) {
      throw new LeaseNotHeldError(key, holder);
    }
    this.store.delete(key);
  }
}

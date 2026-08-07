import type { SafetyState } from '../domain/states.js';

/**
 * Gatilhos que forçam a saída do estado seguro.
 */
export const SAFETY_TRIGGERS = [
  'CAPTCHA',
  'CHALLENGE',
  'WARNING',
  'SESSION_EXPIRED',
  'ACCOUNT_CHANGED',
  'UNEXPECTED_DOMAIN',
  'UNKNOWN_INTERFACE',
  'REPEATED_ERROR',
  'UNCONFIRMED_RESULT',
  'DB_PAGE_DIVERGENCE',
  'MANUAL_PAUSE',
] as const;
export type SafetyTrigger = (typeof SAFETY_TRIGGERS)[number];

const TRIGGER_TO_STATE: Record<SafetyTrigger, SafetyState> = {
  CAPTCHA: 'CAPTCHA_DETECTED',
  CHALLENGE: 'CHALLENGE_DETECTED',
  WARNING: 'WARNING_DETECTED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  ACCOUNT_CHANGED: 'ACCOUNT_CHANGED',
  UNEXPECTED_DOMAIN: 'UNKNOWN_INTERFACE',
  UNKNOWN_INTERFACE: 'UNKNOWN_INTERFACE',
  REPEATED_ERROR: 'SUSPENDED',
  UNCONFIRMED_RESULT: 'NEEDS_MANUAL_REVIEW',
  DB_PAGE_DIVERGENCE: 'NEEDS_MANUAL_REVIEW',
  MANUAL_PAUSE: 'PAUSED',
};

export interface SafetyEvent {
  readonly trigger: SafetyTrigger;
  readonly detail?: string;
}

export interface SafetyRecord {
  readonly trigger: SafetyTrigger;
  readonly state: SafetyState;
  readonly detail: string;
  readonly at: string;
}

/**
 * Erro lançado quando um workflow tenta agir com o sistema fora de `SAFE`.
 */
export class SafetyBlockedError extends Error {
  readonly state: SafetyState;

  constructor(state: SafetyState, detail: string) {
    super(`Ação bloqueada pelo SafetyMonitor: estado ${state}. ${detail}`.trim());
    this.name = 'SafetyBlockedError';
    this.state = state;
  }
}

export interface SafetyMonitorOptions {
  /** Relógio injetável para testes determinísticos. */
  readonly now?: () => Date;
}

/**
 * Monitor central de segurança usado por todos os workflows.
 *
 * Invariantes:
 * - Começa em `SAFE`.
 * - Qualquer gatilho move para um estado bloqueante e é registrado.
 * - Não há retomada automática: só `resume()` explícito volta para `SAFE`.
 * - Nenhuma ação é permitida fora de `SAFE`.
 */
export class SafetyMonitor {
  private state: SafetyState = 'SAFE';
  private readonly records: SafetyRecord[] = [];
  private readonly now: () => Date;

  constructor(options: SafetyMonitorOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  getState(): SafetyState {
    return this.state;
  }

  isSafe(): boolean {
    return this.state === 'SAFE';
  }

  history(): readonly SafetyRecord[] {
    return [...this.records];
  }

  /** Motivo do bloqueio mais recente, se houver. */
  reason(): SafetyRecord | undefined {
    return this.records.at(-1);
  }

  /**
   * Registra um evento de segurança e transiciona para o estado bloqueante.
   */
  report(event: SafetyEvent): SafetyState {
    const state = TRIGGER_TO_STATE[event.trigger];
    this.state = state;
    this.records.push({
      trigger: event.trigger,
      state,
      detail: event.detail ?? '',
      at: this.now().toISOString(),
    });
    return state;
  }

  /**
   * Lança `SafetyBlockedError` se o sistema não estiver seguro.
   */
  assertSafe(): void {
    if (this.state !== 'SAFE') {
      const last = this.reason();
      throw new SafetyBlockedError(this.state, last?.detail ?? '');
    }
  }

  /**
   * Retorno explícito ao estado seguro após revisão manual. Nunca automático.
   */
  resume(detail = 'retomada manual explícita'): void {
    this.state = 'SAFE';
    this.records.push({
      trigger: 'MANUAL_PAUSE',
      state: 'SAFE',
      detail,
      at: this.now().toISOString(),
    });
  }
}

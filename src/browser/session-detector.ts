import type { SafetyState } from '../domain/states.js';
import type { SafetyTrigger } from '../safety/safety-monitor.js';

export type SessionStatus = 'authenticated' | 'unauthenticated' | 'expired' | 'unknown';

/**
 * Sinais brutos lidos da página. São propositalmente simples e serializáveis
 * para permitir classificação pura e testável sem um navegador real.
 */
export interface SessionSignals {
  readonly url: string;
  readonly host: string;
  readonly isUnexpectedDomain: boolean;
  readonly onLoginPage: boolean;
  readonly captchaPresent: boolean;
  readonly challengePresent: boolean;
  readonly warningPresent: boolean;
  readonly activeUsername: string | null;
  /** Indício de que a sessão existia mas expirou (ex.: redirecionamento para login). */
  readonly sessionExpiredHint?: boolean;
}

export interface SessionAssessment {
  readonly sessionStatus: SessionStatus;
  readonly activeAccount: string | null;
  readonly safetyState: SafetyState;
  readonly safetyTrigger: SafetyTrigger | null;
}

/**
 * Classifica a sessão de forma conservadora (falha fechada).
 *
 * Precedência: CAPTCHA → desafio → aviso → domínio inesperado →
 * expirada → login (não autenticada) → autenticada → desconhecida.
 */
export function assessSession(signals: SessionSignals): SessionAssessment {
  if (signals.captchaPresent) {
    return { sessionStatus: 'unknown', activeAccount: null, safetyState: 'CAPTCHA_DETECTED', safetyTrigger: 'CAPTCHA' };
  }
  if (signals.challengePresent) {
    return { sessionStatus: 'unknown', activeAccount: null, safetyState: 'CHALLENGE_DETECTED', safetyTrigger: 'CHALLENGE' };
  }
  if (signals.warningPresent) {
    return { sessionStatus: 'unknown', activeAccount: null, safetyState: 'WARNING_DETECTED', safetyTrigger: 'WARNING' };
  }
  if (signals.isUnexpectedDomain) {
    return { sessionStatus: 'unknown', activeAccount: null, safetyState: 'UNKNOWN_INTERFACE', safetyTrigger: 'UNEXPECTED_DOMAIN' };
  }
  if (signals.onLoginPage) {
    if (signals.sessionExpiredHint) {
      return { sessionStatus: 'expired', activeAccount: null, safetyState: 'SESSION_EXPIRED', safetyTrigger: 'SESSION_EXPIRED' };
    }
    return { sessionStatus: 'unauthenticated', activeAccount: null, safetyState: 'SAFE', safetyTrigger: null };
  }
  if (signals.activeUsername && signals.activeUsername.trim().length > 0) {
    return { sessionStatus: 'authenticated', activeAccount: signals.activeUsername, safetyState: 'SAFE', safetyTrigger: null };
  }
  // Nada reconhecível: falha fechada.
  return { sessionStatus: 'unknown', activeAccount: null, safetyState: 'UNKNOWN_INTERFACE', safetyTrigger: 'UNKNOWN_INTERFACE' };
}

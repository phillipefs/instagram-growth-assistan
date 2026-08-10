import type { SafetyState, FollowBackState } from '../domain/states.js';
import type { ProfileType } from './profile-detector.js';

export interface FollowBackSignals {
  readonly safetyState: SafetyState;
  readonly profileType: ProfileType;
  readonly followsYou: boolean;
  /** Ausência comprovada em uma lista de seguidores carregada por completo. */
  readonly notFollowingConfirmed?: boolean;
}

export interface FollowBackAssessment {
  readonly value: FollowBackState;
  readonly safetyState: SafetyState;
  readonly reason: string;
}

/**
 * Classifica o follow-back de forma conservadora (falha fechada).
 *
 * O selo "segue você" confirma `YES`. A ausência do selo não prova `NO`,
 * pois a interface pode omiti-lo. Segurança bloqueante ou qualquer resultado
 * sem confirmação positiva resultam em `UNKNOWN` (falha fechada).
 */
export function assessFollowBack(signals: FollowBackSignals): FollowBackAssessment {
  if (signals.safetyState !== 'SAFE') {
    return {
      value: 'UNKNOWN',
      safetyState: signals.safetyState,
      reason: 'estado de segurança bloqueante',
    };
  }
  if (signals.followsYou) {
    return { value: 'YES', safetyState: 'SAFE', reason: 'selo "segue você" presente' };
  }
  if (signals.notFollowingConfirmed) {
    return {
      value: 'NO',
      safetyState: 'SAFE',
      reason: 'ausente da lista completa de seguidores da conta ativa',
    };
  }
  return {
    value: 'UNKNOWN',
    safetyState: 'SAFE',
    reason: `ausência do selo não confirma que o perfil não segue (${signals.profileType})`,
  };
}

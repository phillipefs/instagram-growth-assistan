import type { SafetyState, FollowBackState } from '../domain/states.js';
import type { ProfileType } from './profile-detector.js';

export interface FollowBackSignals {
  readonly safetyState: SafetyState;
  readonly profileType: ProfileType;
  readonly followsYou: boolean;
}

export interface FollowBackAssessment {
  readonly value: FollowBackState;
  readonly safetyState: SafetyState;
  readonly reason: string;
}

/**
 * Classifica o follow-back de forma conservadora (falha fechada).
 *
 * O selo "segue você" confirma `YES`. Um perfil legível sem o selo indica `NO`.
 * Segurança bloqueante ou perfil não legível resultam em `UNKNOWN`.
 */
export function assessFollowBack(signals: FollowBackSignals): FollowBackAssessment {
  if (signals.safetyState !== 'SAFE') {
    return { value: 'UNKNOWN', safetyState: signals.safetyState, reason: 'estado de segurança bloqueante' };
  }
  if (signals.followsYou) {
    return { value: 'YES', safetyState: 'SAFE', reason: 'selo "segue você" presente' };
  }
  if (signals.profileType === 'PUBLIC' || signals.profileType === 'PRIVATE') {
    return { value: 'NO', safetyState: 'SAFE', reason: 'perfil legível sem o selo' };
  }
  return { value: 'UNKNOWN', safetyState: 'SAFE', reason: `perfil não legível (${signals.profileType})` };
}

import type { SafetyState } from '../domain/states.js';
import type { SafetyTrigger } from '../safety/safety-monitor.js';

export type ProfileType = 'PUBLIC' | 'PRIVATE' | 'UNAVAILABLE' | 'NOT_FOUND' | 'UNKNOWN';

export type ObservedRelationship =
  | 'NOT_FOLLOWING'
  | 'FOLLOW_REQUESTED'
  | 'FOLLOWING'
  | 'UNKNOWN';

export type FollowButtonState = 'FOLLOW' | 'FOLLOWING' | 'REQUESTED';

export interface ProfileSignals {
  readonly url: string;
  readonly host: string;
  readonly isUnexpectedDomain: boolean;
  readonly captchaPresent: boolean;
  readonly challengePresent: boolean;
  readonly warningPresent: boolean;
  readonly notFound: boolean;
  readonly isPrivate: boolean;
  readonly usernameShown: string | null;
  readonly followButtonState: FollowButtonState | null;
  readonly hasFollowersAccess: boolean;
  readonly postsVisible: number;
  readonly followersCount: number | null;
  readonly followingCount: number | null;
}

export interface ProfileAssessment {
  readonly profileType: ProfileType;
  readonly username: string | null;
  readonly relationshipState: ObservedRelationship;
  readonly hasFollowersAccess: boolean;
  readonly hasPosts: boolean;
  readonly postsVisible: number;
  readonly followersCount: number | null;
  readonly followingCount: number | null;
  readonly safetyState: SafetyState;
  readonly safetyTrigger: SafetyTrigger | null;
  readonly unknownFields: readonly string[];
}

function relationshipFromButton(state: FollowButtonState | null): ObservedRelationship {
  switch (state) {
    case 'FOLLOW':
      return 'NOT_FOLLOWING';
    case 'FOLLOWING':
      return 'FOLLOWING';
    case 'REQUESTED':
      return 'FOLLOW_REQUESTED';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Classifica um perfil de forma conservadora (falha fechada).
 *
 * Segurança tem precedência; depois indisponibilidade; depois tipo de perfil,
 * relacionamento observado e presença de seguidores/publicações.
 */
export function assessProfile(signals: ProfileSignals): ProfileAssessment {
  const base = {
    username: signals.usernameShown,
    relationshipState: relationshipFromButton(signals.followButtonState),
    hasFollowersAccess: signals.hasFollowersAccess,
    hasPosts: signals.postsVisible > 0,
    postsVisible: signals.postsVisible,
    followersCount: signals.followersCount,
    followingCount: signals.followingCount,
    unknownFields: [] as string[],
  };

  if (signals.captchaPresent) {
    return { ...base, profileType: 'UNKNOWN', safetyState: 'CAPTCHA_DETECTED', safetyTrigger: 'CAPTCHA' };
  }
  if (signals.challengePresent) {
    return { ...base, profileType: 'UNKNOWN', safetyState: 'CHALLENGE_DETECTED', safetyTrigger: 'CHALLENGE' };
  }
  if (signals.warningPresent) {
    return { ...base, profileType: 'UNKNOWN', safetyState: 'WARNING_DETECTED', safetyTrigger: 'WARNING' };
  }
  if (signals.isUnexpectedDomain) {
    return { ...base, profileType: 'UNKNOWN', safetyState: 'UNKNOWN_INTERFACE', safetyTrigger: 'UNEXPECTED_DOMAIN' };
  }
  if (signals.notFound) {
    return { ...base, profileType: 'NOT_FOUND', safetyState: 'SAFE', safetyTrigger: null };
  }

  if (signals.isPrivate) {
    return { ...base, profileType: 'PRIVATE', safetyState: 'SAFE', safetyTrigger: null };
  }
  if (signals.usernameShown && signals.usernameShown.trim().length > 0) {
    return { ...base, profileType: 'PUBLIC', safetyState: 'SAFE', safetyTrigger: null };
  }

  // Não foi possível reconhecer: falha fechada.
  return {
    ...base,
    profileType: 'UNKNOWN',
    safetyState: 'UNKNOWN_INTERFACE',
    safetyTrigger: 'UNKNOWN_INTERFACE',
    unknownFields: ['profileType', 'username'],
  };
}

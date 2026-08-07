import { describe, expect, it } from 'vitest';
import { assessProfile, type ProfileSignals } from '../../src/browser/profile-detector.js';

function signals(overrides: Partial<ProfileSignals> = {}): ProfileSignals {
  return {
    url: 'https://www.instagram.com/perfil/',
    host: 'www.instagram.com',
    isUnexpectedDomain: false,
    captchaPresent: false,
    challengePresent: false,
    warningPresent: false,
    notFound: false,
    isPrivate: false,
    usernameShown: 'perfil',
    followButtonState: 'FOLLOW',
    hasFollowersAccess: true,
    postsVisible: 3,
    followersCount: null,
    followingCount: null,
    ...overrides,
  };
}

describe('assessProfile', () => {
  it('reconhece perfil público não seguido', () => {
    const result = assessProfile(signals());
    expect(result.profileType).toBe('PUBLIC');
    expect(result.relationshipState).toBe('NOT_FOLLOWING');
    expect(result.hasPosts).toBe(true);
    expect(result.safetyState).toBe('SAFE');
  });

  it('reconhece perfil privado', () => {
    const result = assessProfile(signals({ isPrivate: true, hasFollowersAccess: false, postsVisible: 0 }));
    expect(result.profileType).toBe('PRIVATE');
  });

  it('mapeia estados do botão de seguir', () => {
    expect(assessProfile(signals({ followButtonState: 'FOLLOWING' })).relationshipState).toBe('FOLLOWING');
    expect(assessProfile(signals({ followButtonState: 'REQUESTED' })).relationshipState).toBe('FOLLOW_REQUESTED');
    expect(assessProfile(signals({ followButtonState: null })).relationshipState).toBe('UNKNOWN');
  });

  it('reconhece perfil inexistente', () => {
    const result = assessProfile(signals({ notFound: true, usernameShown: null }));
    expect(result.profileType).toBe('NOT_FOUND');
    expect(result.safetyState).toBe('SAFE');
  });

  it('dá precedência à segurança sobre o tipo de perfil', () => {
    expect(assessProfile(signals({ captchaPresent: true })).safetyState).toBe('CAPTCHA_DETECTED');
    expect(assessProfile(signals({ challengePresent: true })).safetyState).toBe('CHALLENGE_DETECTED');
    expect(assessProfile(signals({ warningPresent: true })).safetyState).toBe('WARNING_DETECTED');
  });

  it('falha fechada quando nada é reconhecível', () => {
    const result = assessProfile(signals({ usernameShown: null, followButtonState: null, postsVisible: 0 }));
    expect(result.profileType).toBe('UNKNOWN');
    expect(result.safetyState).toBe('UNKNOWN_INTERFACE');
    expect(result.unknownFields).toContain('username');
  });
});

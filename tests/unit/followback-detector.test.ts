import { describe, expect, it } from 'vitest';
import { assessFollowBack } from '../../src/browser/followback-detector.js';

describe('assessFollowBack', () => {
  it('YES quando o selo está presente', () => {
    expect(
      assessFollowBack({ safetyState: 'SAFE', profileType: 'PUBLIC', followsYou: true }).value,
    ).toBe('YES');
  });
  it('UNKNOWN quando o selo está ausente, mesmo em perfil legível', () => {
    expect(
      assessFollowBack({ safetyState: 'SAFE', profileType: 'PUBLIC', followsYou: false }).value,
    ).toBe('UNKNOWN');
    expect(
      assessFollowBack({ safetyState: 'SAFE', profileType: 'PRIVATE', followsYou: false }).value,
    ).toBe('UNKNOWN');
  });
  it('NO somente quando a lista completa confirma a ausência', () => {
    expect(
      assessFollowBack({
        safetyState: 'SAFE',
        profileType: 'UNKNOWN',
        followsYou: false,
        notFollowingConfirmed: true,
      }).value,
    ).toBe('NO');
  });
  it('UNKNOWN em perfil não legível', () => {
    expect(
      assessFollowBack({ safetyState: 'SAFE', profileType: 'NOT_FOUND', followsYou: false }).value,
    ).toBe('UNKNOWN');
  });
  it('UNKNOWN sob estado de segurança bloqueante', () => {
    const r = assessFollowBack({
      safetyState: 'CAPTCHA_DETECTED',
      profileType: 'PUBLIC',
      followsYou: true,
    });
    expect(r.value).toBe('UNKNOWN');
    expect(r.safetyState).toBe('CAPTCHA_DETECTED');
  });
});

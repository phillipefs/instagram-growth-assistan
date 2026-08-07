import { describe, expect, it } from 'vitest';
import {
  isFollowBackBlockingUnfollow,
  isOriginEligibleForAutoUnfollow,
} from '../../src/domain/states.js';

describe('isOriginEligibleForAutoUnfollow', () => {
  it('permite apenas follows executados pela ferramenta', () => {
    expect(isOriginEligibleForAutoUnfollow('TOOL_CLICK')).toBe(true);
  });

  it('bloqueia follows manuais, importados e preexistentes', () => {
    expect(isOriginEligibleForAutoUnfollow('USER_CLICK_OBSERVED')).toBe(false);
    expect(isOriginEligibleForAutoUnfollow('IMPORTED')).toBe(false);
    expect(isOriginEligibleForAutoUnfollow('PREEXISTING')).toBe(false);
  });
});

describe('isFollowBackBlockingUnfollow', () => {
  it('preserva quem seguiu de volta e quem tem estado desconhecido', () => {
    expect(isFollowBackBlockingUnfollow('YES', true)).toBe(true);
    expect(isFollowBackBlockingUnfollow('UNKNOWN', true)).toBe(true);
  });

  it('permite unfollow apenas de quem comprovadamente não segue de volta', () => {
    expect(isFollowBackBlockingUnfollow('NO', true)).toBe(false);
  });

  it('não bloqueia quando a preservação está desligada', () => {
    expect(isFollowBackBlockingUnfollow('YES', false)).toBe(false);
    expect(isFollowBackBlockingUnfollow('UNKNOWN', false)).toBe(false);
  });
});

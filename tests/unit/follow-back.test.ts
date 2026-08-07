import { describe, expect, it } from 'vitest';
import {
  isEligibleForUnfollowByFollowBack,
  isObservationFresh,
} from '../../src/domain/follow-back.js';

const now = new Date('2026-08-06T00:00:00.000Z');

describe('isObservationFresh', () => {
  it('considera fresco dentro da validade', () => {
    expect(isObservationFresh('2026-08-01T00:00:00.000Z', 7, now)).toBe(true);
  });
  it('considera vencido além da validade', () => {
    expect(isObservationFresh('2026-07-01T00:00:00.000Z', 7, now)).toBe(false);
  });
  it('trata ausência de data como não fresco', () => {
    expect(isObservationFresh(null, 7, now)).toBe(false);
  });
});

describe('isEligibleForUnfollowByFollowBack', () => {
  const base = { validityDays: 7, preserveFollowBacks: true, now };

  it('elegível apenas com NO fresco', () => {
    expect(
      isEligibleForUnfollowByFollowBack({ ...base, value: 'NO', checkedAt: '2026-08-05T00:00:00.000Z' }),
    ).toBe(true);
  });
  it('bloqueia YES e UNKNOWN', () => {
    expect(isEligibleForUnfollowByFollowBack({ ...base, value: 'YES', checkedAt: '2026-08-05T00:00:00.000Z' })).toBe(false);
    expect(isEligibleForUnfollowByFollowBack({ ...base, value: 'UNKNOWN', checkedAt: '2026-08-05T00:00:00.000Z' })).toBe(false);
  });
  it('bloqueia NO vencido', () => {
    expect(isEligibleForUnfollowByFollowBack({ ...base, value: 'NO', checkedAt: '2026-07-01T00:00:00.000Z' })).toBe(false);
  });
  it('libera tudo quando não preserva follow-backs', () => {
    expect(
      isEligibleForUnfollowByFollowBack({ ...base, preserveFollowBacks: false, value: 'YES', checkedAt: null }),
    ).toBe(true);
  });
});

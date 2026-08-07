import { describe, expect, it } from 'vitest';
import { interpretUnfollowResult } from '../../src/workflows/unfollow-result.js';

describe('interpretUnfollowResult', () => {
  it('confirma quando termina NOT_FOLLOWING', () => {
    expect(interpretUnfollowResult('FOLLOWING', 'NOT_FOLLOWING')).toEqual({ result: 'CONFIRMED', detail: 'UNFOLLOWED' });
  });

  it('distingue cancelamento de solicitação pendente', () => {
    expect(interpretUnfollowResult('FOLLOW_REQUESTED', 'NOT_FOLLOWING')).toEqual({
      result: 'CONFIRMED',
      detail: 'CANCEL_FOLLOW_REQUEST',
    });
  });

  it('é ambíguo quando ainda segue', () => {
    expect(interpretUnfollowResult('FOLLOWING', 'FOLLOWING').result).toBe('AMBIGUOUS');
  });

  it('é ambíguo em estado desconhecido', () => {
    expect(interpretUnfollowResult('FOLLOWING', 'UNKNOWN').result).toBe('AMBIGUOUS');
  });
});

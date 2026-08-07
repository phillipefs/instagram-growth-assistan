import { describe, expect, it } from 'vitest';
import { interpretFollowResult } from '../../src/workflows/follow-result.js';

describe('interpretFollowResult', () => {
  it('confirma quando passa a seguir', () => {
    expect(interpretFollowResult('NOT_FOLLOWING', 'FOLLOWING').result).toBe('CONFIRMED');
  });

  it('confirma quando a solicitação é enviada', () => {
    const r = interpretFollowResult('NOT_FOLLOWING', 'FOLLOW_REQUESTED');
    expect(r.result).toBe('CONFIRMED');
    expect(r.detail).toBe('FOLLOW_REQUESTED');
  });

  it('é ambíguo quando não há mudança visual', () => {
    expect(interpretFollowResult('NOT_FOLLOWING', 'NOT_FOLLOWING').result).toBe('AMBIGUOUS');
    expect(interpretFollowResult('NOT_FOLLOWING', 'UNKNOWN').result).toBe('AMBIGUOUS');
  });
});

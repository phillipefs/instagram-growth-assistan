import { describe, expect, it } from 'vitest';
import { interpretLikeResult } from '../../src/workflows/like-result.js';

describe('interpretLikeResult', () => {
  it('confirma quando fica curtido', () => {
    expect(interpretLikeResult('LIKED').result).toBe('CONFIRMED');
  });
  it('é ambíguo quando não confirma', () => {
    expect(interpretLikeResult('NOT_LIKED').result).toBe('AMBIGUOUS');
    expect(interpretLikeResult('UNKNOWN').result).toBe('AMBIGUOUS');
  });
});

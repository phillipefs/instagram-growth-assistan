import { describe, expect, it } from 'vitest';
import { hashObject, stableStringify } from '../../src/domain/hash.js';

describe('hash estável', () => {
  it('independe da ordem das chaves', () => {
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }));
  });

  it('preserva a ordem de arrays', () => {
    expect(hashObject([1, 2, 3])).not.toBe(hashObject([3, 2, 1]));
  });

  it('muda com valores diferentes', () => {
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });

  it('ignora chaves undefined', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

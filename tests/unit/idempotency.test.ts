import { describe, expect, it } from 'vitest';
import { buildIdempotencyKey } from '../../src/domain/idempotency.js';

describe('buildIdempotencyKey', () => {
  const base = {
    localAccount: 'MinhaConta',
    actionType: 'FOLLOW' as const,
    targetEntityId: 'Candidato_1',
  };

  it('é determinística e insensível a espaços/maiúsculas', () => {
    const a = buildIdempotencyKey(base);
    const b = buildIdempotencyKey({ ...base, localAccount: '  minhaconta ', targetEntityId: 'candidato_1' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('difere entre tipos de ação distintos', () => {
    const follow = buildIdempotencyKey(base);
    const unfollow = buildIdempotencyKey({ ...base, actionType: 'UNFOLLOW' });
    expect(follow).not.toBe(unfollow);
  });

  it('difere quando o ciclo de relacionamento muda', () => {
    const cycle1 = buildIdempotencyKey({ ...base, relationshipCycleId: 'c1' });
    const cycle2 = buildIdempotencyKey({ ...base, relationshipCycleId: 'c2' });
    expect(cycle1).not.toBe(cycle2);
  });

  it('exige mediaId para curtidas', () => {
    expect(() =>
      buildIdempotencyKey({ ...base, actionType: 'LIKE_POST' }),
    ).toThrow(/mediaId/);
    expect(
      buildIdempotencyKey({ ...base, actionType: 'LIKE_POST', mediaId: 'ABC123' }),
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejeita alvo vazio', () => {
    expect(() => buildIdempotencyKey({ ...base, targetEntityId: '   ' })).toThrow();
  });
});

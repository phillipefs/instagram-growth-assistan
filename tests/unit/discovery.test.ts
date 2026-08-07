import { describe, expect, it } from 'vitest';
import {
  compareByEngagement,
  discoverySourcePriority,
  engagementScore,
} from '../../src/domain/discovery.js';

describe('engajamento', () => {
  it('pontua comentário acima de curtida acima de seguir', () => {
    expect(engagementScore([{ type: 'COMMENT' }])).toBe(3);
    expect(engagementScore([{ type: 'LIKE' }])).toBe(2);
    expect(engagementScore([{ type: 'FOLLOWS_TARGET' }])).toBe(1);
    expect(engagementScore([{ type: 'COMMENT' }, { type: 'LIKE' }])).toBe(5);
  });

  it('prioriza comentaristas, depois curtidores, depois seguidores', () => {
    expect(discoverySourcePriority('RECENT_POST_COMMENTERS')).toBeLessThan(
      discoverySourcePriority('RECENT_POST_LIKERS'),
    );
    expect(discoverySourcePriority('RECENT_POST_LIKERS')).toBeLessThan(
      discoverySourcePriority('FOLLOWERS'),
    );
  });

  it('ordena candidatos do mais engajado para o menos engajado', () => {
    const commenter = { discoverySource: 'RECENT_POST_COMMENTERS' as const, signals: [{ type: 'COMMENT' as const }] };
    const liker = { discoverySource: 'RECENT_POST_LIKERS' as const, signals: [{ type: 'LIKE' as const }] };
    const follower = { discoverySource: 'FOLLOWERS' as const, signals: [] };
    const ordered = [follower, liker, commenter].sort(compareByEngagement);
    expect(ordered.map((c) => c.discoverySource)).toEqual([
      'RECENT_POST_COMMENTERS',
      'RECENT_POST_LIKERS',
      'FOLLOWERS',
    ]);
  });

  it('desempata pela prioridade da fonte quando o score é igual', () => {
    const a = { discoverySource: 'FOLLOWERS' as const, signals: [{ type: 'LIKE' as const }] };
    const b = { discoverySource: 'RECENT_POST_LIKERS' as const, signals: [{ type: 'LIKE' as const }] };
    const ordered = [a, b].sort(compareByEngagement);
    expect(ordered[0]?.discoverySource).toBe('RECENT_POST_LIKERS');
  });
});

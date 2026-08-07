import { describe, expect, it } from 'vitest';
import { selectRecentPost, type PostCandidate } from '../../src/domain/recent-post.js';

const now = new Date('2026-08-06T00:00:00.000Z');

function post(overrides: Partial<PostCandidate> & { shortcode: string; positionIndex: number }): PostCandidate {
  return { ...overrides };
}

describe('selectRecentPost', () => {
  it('escolhe a publicação mais recente por data', () => {
    const result = selectRecentPost(
      [
        post({ shortcode: 'OLD', positionIndex: 1, publishedAt: '2026-06-01T00:00:00.000Z' }),
        post({ shortcode: 'NEW', positionIndex: 0, publishedAt: '2026-08-01T00:00:00.000Z' }),
      ],
      { now, maxAgeDays: 30 },
    );
    expect(result.post?.shortcode).toBe('NEW');
  });

  it('não escolhe nada se todas passam da idade máxima', () => {
    const result = selectRecentPost(
      [post({ shortcode: 'OLD', positionIndex: 0, publishedAt: '2026-01-01T00:00:00.000Z' })],
      { now, maxAgeDays: 30 },
    );
    expect(result.post).toBeNull();
  });

  it('sem datas, usa a primeira não fixada por posição', () => {
    const result = selectRecentPost(
      [
        post({ shortcode: 'PIN', positionIndex: 0, isPinned: true }),
        post({ shortcode: 'P1', positionIndex: 1 }),
        post({ shortcode: 'P2', positionIndex: 2 }),
      ],
      { now },
    );
    expect(result.post?.shortcode).toBe('P1');
  });

  it('sem publicações retorna nulo', () => {
    expect(selectRecentPost([], { now }).post).toBeNull();
  });
});

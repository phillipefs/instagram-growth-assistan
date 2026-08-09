import { describe, expect, it } from 'vitest';
import { buildFollowPreview, type PlanCandidate } from '../../src/workflows/plan-follow.js';

function candidate(overrides: Partial<PlanCandidate>): PlanCandidate {
  return {
    candidateId: 'c',
    profileId: 'p',
    username: 'user',
    discoverySource: 'FOLLOWERS',
    score: 0,
    alreadyFollowing: false,
    previouslyAttempted: false,
    whitelisted: false,
    protected: false,
    ...overrides,
  };
}

describe('buildFollowPreview', () => {
  const candidates: PlanCandidate[] = [
    candidate({ username: 'commenter', discoverySource: 'RECENT_POST_COMMENTERS', score: 5 }),
    candidate({ username: 'liker', discoverySource: 'RECENT_POST_LIKERS', score: 2 }),
    candidate({ username: 'follower', discoverySource: 'FOLLOWERS', score: 0 }),
    candidate({ username: 'whitelisted', whitelisted: true, score: 9 }),
    candidate({ username: 'protegido', protected: true, score: 9 }),
    candidate({ username: 'ja_seguido', alreadyFollowing: true, score: 9 }),
  ];

  it('exclui whitelist, protegidos e já seguidos', () => {
    const preview = buildFollowPreview(candidates);
    expect(preview.excluded).toEqual({
      whitelisted: 1,
      protected: 1,
      already_following: 1,
      previously_attempted: 0,
    });
    expect(preview.totalApproved).toBe(3);
  });

  it('ordena por engajamento (score) decrescente', () => {
    const preview = buildFollowPreview(candidates);
    expect(preview.proposed.map((p) => p.username)).toEqual(['commenter', 'liker', 'follower']);
  });

  it('respeita o limite', () => {
    const preview = buildFollowPreview(candidates, { limit: 2 });
    expect(preview.totalProposed).toBe(2);
    expect(preview.proposed.map((p) => p.username)).toEqual(['commenter', 'liker']);
  });

  it('exclui tentativas anteriores somente quando solicitado', () => {
    const attempted = candidate({ username: 'tentado', previouslyAttempted: true });
    expect(buildFollowPreview([attempted]).totalProposed).toBe(1);
    const preview = buildFollowPreview([attempted], { onlyUnattempted: true });
    expect(preview.totalProposed).toBe(0);
    expect(preview.excluded.previously_attempted).toBe(1);
  });

  it('restringe a usernames explicitamente selecionados', () => {
    const preview = buildFollowPreview(candidates, { usernames: ['@liker', 'follower'] });
    expect(preview.proposed.map((p) => p.username)).toEqual(['liker', 'follower']);
  });
});

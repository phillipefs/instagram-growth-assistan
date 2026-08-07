/**
 * Seleção de uma publicação recente para curtida.
 *
 * Regra documentada: preferir a publicação mais recente por data dentro da idade
 * máxima; publicações fixadas antigas não são escolhidas por posição. Sem datas
 * disponíveis, usa a primeira não fixada (best-effort).
 */
export interface PostCandidate {
  readonly shortcode: string;
  readonly publishedAt?: string;
  readonly isPinned?: boolean;
  readonly positionIndex: number;
}

export interface SelectRecentPostOptions {
  readonly now?: Date;
  readonly maxAgeDays?: number;
}

export interface RecentPostSelection {
  readonly post: PostCandidate | null;
  readonly reason: string;
}

function ageInDays(publishedAt: string, now: Date): number {
  const published = new Date(publishedAt).getTime();
  return (now.getTime() - published) / 86_400_000;
}

export function selectRecentPost(
  posts: readonly PostCandidate[],
  options: SelectRecentPostOptions = {},
): RecentPostSelection {
  const now = options.now ?? new Date();
  const maxAgeDays = options.maxAgeDays ?? 30;

  if (posts.length === 0) {
    return { post: null, reason: 'sem publicações visíveis' };
  }

  const dated = posts.filter((p) => p.publishedAt !== undefined);
  if (dated.length > 0) {
    const withinAge = dated.filter((p) => ageInDays(p.publishedAt as string, now) <= maxAgeDays);
    if (withinAge.length === 0) {
      return { post: null, reason: 'nenhuma publicação dentro da idade máxima' };
    }
    const newest = withinAge.reduce((a, b) =>
      new Date(a.publishedAt as string) >= new Date(b.publishedAt as string) ? a : b,
    );
    return { post: newest, reason: 'publicação mais recente por data' };
  }

  const nonPinned = posts
    .filter((p) => !p.isPinned)
    .sort((a, b) => a.positionIndex - b.positionIndex);
  const chosen = nonPinned[0];
  if (!chosen) {
    return { post: null, reason: 'apenas publicações fixadas sem data' };
  }
  return { post: chosen, reason: 'sem data; usando primeira não fixada por posição' };
}

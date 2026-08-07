/**
 * Fontes de descoberta de candidatos e sinais de engajamento.
 *
 * A estratégia prioriza pessoas engajadas (que comentaram ou curtiram
 * publicações recentes do perfil-alvo) sobre a lista bruta de seguidores,
 * que costuma conter muitas contas inativas.
 */

export const DISCOVERY_SOURCES = [
  'RECENT_POST_COMMENTERS',
  'RECENT_POST_LIKERS',
  'FOLLOWERS',
  'MANUAL_IMPORT',
] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export const ENGAGEMENT_TYPES = ['COMMENT', 'LIKE', 'FOLLOWS_TARGET'] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

/** Peso de cada sinal de engajamento (comentar vale mais que curtir). */
const ENGAGEMENT_WEIGHT: Record<EngagementType, number> = {
  COMMENT: 3,
  LIKE: 2,
  FOLLOWS_TARGET: 1,
};

/** Prioridade da fonte de descoberta (menor = mais engajado). */
const SOURCE_PRIORITY: Record<DiscoverySource, number> = {
  RECENT_POST_COMMENTERS: 0,
  RECENT_POST_LIKERS: 1,
  FOLLOWERS: 2,
  MANUAL_IMPORT: 3,
};

export function discoverySourcePriority(source: DiscoverySource): number {
  return SOURCE_PRIORITY[source];
}

/** Soma os pesos dos sinais de engajamento observados. */
export function engagementScore(signals: readonly { type: EngagementType }[]): number {
  return signals.reduce((total, signal) => total + ENGAGEMENT_WEIGHT[signal.type], 0);
}

export interface RankableCandidate {
  readonly discoverySource: DiscoverySource;
  readonly signals: readonly { type: EngagementType }[];
}

/**
 * Comparador para ordenar candidatos do mais engajado para o menos engajado:
 * maior score primeiro; empate desempatado pela prioridade da fonte.
 */
export function compareByEngagement(a: RankableCandidate, b: RankableCandidate): number {
  const scoreDiff = engagementScore(b.signals) - engagementScore(a.signals);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return discoverySourcePriority(a.discoverySource) - discoverySourcePriority(b.discoverySource);
}

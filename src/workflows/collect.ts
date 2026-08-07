import type { DiscoverySource, EngagementType } from '../domain/discovery.js';
import { discoverySourcePriority } from '../domain/discovery.js';
import { isValidInstagramUsername } from '../domain/username.js';
import { canonicalUsername } from '../database/util.js';
import type { ProfileRepo } from '../database/repositories/profiles.js';
import type { CampaignCandidateRepo } from '../database/repositories/campaigns.js';
import type { CandidateSignalRepo } from '../database/repositories/candidate-signals.js';

export interface DiscoveredItem {
  readonly username: string;
  readonly source: DiscoverySource;
  readonly signal?: { readonly type: EngagementType; readonly mediaShortcode?: string };
}

export interface CollectionDeps {
  readonly profiles: ProfileRepo;
  readonly candidates: CampaignCandidateRepo;
  readonly signals: CandidateSignalRepo;
}

export interface CollectSummary {
  readonly input: number;
  readonly invalid: number;
  readonly uniqueUsernames: number;
  readonly candidatesCreated: number;
  readonly candidatesExisting: number;
  readonly signalsRecorded: number;
  readonly signalsDuplicated: number;
}

interface Aggregated {
  source: DiscoverySource;
  signals: { type: EngagementType; mediaShortcode?: string }[];
}

/**
 * Ingere candidatos descobertos, deduplicando por username e registrando os
 * sinais de engajamento. É idempotente: reexecutar não duplica.
 *
 * A fonte de descoberta do candidato é a mais engajada observada no lote.
 */
export function ingestDiscovered(
  deps: CollectionDeps,
  campaignId: string,
  items: readonly DiscoveredItem[],
): CollectSummary {
  const grouped = new Map<string, Aggregated>();
  let invalid = 0;

  for (const item of items) {
    if (!isValidInstagramUsername(item.username)) {
      invalid += 1;
      continue;
    }
    const key = canonicalUsername(item.username);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        source: item.source,
        signals: item.signal ? [item.signal] : [],
      });
      continue;
    }
    if (discoverySourcePriority(item.source) < discoverySourcePriority(existing.source)) {
      existing.source = item.source;
    }
    if (item.signal) {
      existing.signals.push(item.signal);
    }
  }

  let candidatesCreated = 0;
  let candidatesExisting = 0;
  let signalsRecorded = 0;
  let signalsDuplicated = 0;

  for (const [username, aggregated] of grouped) {
    const profile = deps.profiles.upsert({ username });
    const { created, candidate } = deps.candidates.add({
      campaignId,
      profileId: profile.id,
      discoverySource: aggregated.source,
    });
    if (created) {
      candidatesCreated += 1;
    } else {
      candidatesExisting += 1;
    }
    for (const signal of aggregated.signals) {
      const result = deps.signals.record({
        campaignCandidateId: candidate.id,
        type: signal.type,
        ...(signal.mediaShortcode ? { mediaShortcode: signal.mediaShortcode } : {}),
      });
      if (result.created) {
        signalsRecorded += 1;
      } else {
        signalsDuplicated += 1;
      }
    }
  }

  return {
    input: items.length,
    invalid,
    uniqueUsernames: grouped.size,
    candidatesCreated,
    candidatesExisting,
    signalsRecorded,
    signalsDuplicated,
  };
}

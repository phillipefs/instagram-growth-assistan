import type { SqliteDatabase } from '../database/connection.js';
import { CampaignCandidateRepo } from '../database/repositories/campaigns.js';
import { FollowerSnapshotRepo } from '../database/repositories/follower-snapshots.js';
import { buildFollowPreview, loadFollowCandidates } from './plan-follow.js';

export interface CampaignSummary {
  readonly candidates: {
    readonly total: number;
    readonly bySource: Record<string, number>;
    readonly byState: Record<string, number>;
  };
  /** Posts distintos que produziram ao menos um sinal de comentário/curtida. */
  readonly postsWithSignals: number;
  readonly engagementSignals: Record<string, number>;
  readonly currentRelationships: {
    readonly following: number;
    readonly requested: number;
    readonly total: number;
  };
  readonly relationshipHistory: {
    /** Perfis distintos cujo follow foi confirmado e registrado pela ferramenta. */
    readonly toolFollowed: number;
    /** Quantidade total de ciclos de follow, incluindo eventual refollow. */
    readonly followCycles: number;
    /** Perfis distintos que tiveram ao menos um ciclo encerrado. */
    readonly unfollowed: number;
    /** Quantidade total de encerramentos de ciclo. */
    readonly unfollowEvents: number;
  };
  readonly followBacks: {
    readonly yes: number;
    readonly no: number;
    readonly unknown: number;
    /** Perfis cuja inspeção já foi executada, inclusive resultado UNKNOWN. */
    readonly checked: number;
    /** Perfis classificados conclusivamente como YES ou NO. */
    readonly classified: number;
    readonly uninspected: number;
    readonly total: number;
    readonly coveragePct: number | null;
  };
  readonly followersSnapshot: {
    readonly id: string;
    readonly observedAt: string;
    readonly currentTotal: number;
    readonly currentFromCampaign: number;
  } | null;
  readonly conversion: {
    /** Perfis com follow-back `YES` na observação mais recente. */
    readonly followers: number;
    /** Perfis distintos seguidos pela ferramenta nesta campanha. */
    readonly confirmedToolFollows: number;
    readonly ratePct: number | null;
    readonly confirmedNewFollowers: number;
    readonly eligibleWithBaseline: number;
    readonly confirmedRatePct: number | null;
    readonly attributionUnknown: number;
  };
  readonly latestFollowAttempts: {
    readonly confirmed: number;
    readonly ambiguous: number;
    readonly failed: number;
    readonly skipped: number;
    readonly pending: number;
    readonly total: number;
  };
  readonly remaining: {
    readonly eligible: number;
    readonly neverAttempted: number;
  };
  readonly excluded: {
    readonly whitelisted: number;
    readonly protected: number;
    readonly alreadyFollowing: number;
    readonly previouslyAttempted: number;
  };
}

/** Agrega uma campanha para uma conta sem listar cada candidato. Somente leitura. */
export function buildCampaignSummary(
  db: SqliteDatabase,
  campaignId: string,
  localAccountId: string,
): CampaignSummary {
  const allCandidates = new CampaignCandidateRepo(db).listByCampaign(campaignId);
  const bySource: Record<string, number> = {};
  const byState: Record<string, number> = {};
  for (const candidate of allCandidates) {
    bySource[candidate.discoverySource] = (bySource[candidate.discoverySource] ?? 0) + 1;
    byState[candidate.state] = (byState[candidate.state] ?? 0) + 1;
  }

  const signalRows = db
    .prepare(
      `SELECT s.type AS type, COUNT(*) AS n
         FROM candidate_signals s
         JOIN campaign_candidates c ON c.id = s.campaign_candidate_id
        WHERE c.campaign_id = ?
        GROUP BY s.type`,
    )
    .all(campaignId) as { type: string; n: number }[];
  const engagementSignals: Record<string, number> = {};
  for (const row of signalRows) {
    engagementSignals[row.type] = row.n;
  }
  const postsWithSignals = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT s.media_shortcode) AS n
           FROM candidate_signals s
           JOIN campaign_candidates c ON c.id = s.campaign_candidate_id
          WHERE c.campaign_id = ? AND s.media_shortcode IS NOT NULL`,
      )
      .get(campaignId) as { n: number }
  ).n;

  const cycleRows = db
    .prepare(
      `SELECT r.profile_id AS profile_id, rc.state AS state, rc.follow_back AS follow_back,
              rc.follow_back_checked_at AS follow_back_checked_at,
              rc.followed_at AS followed_at,
              rc.unfollowed_at AS unfollowed_at
         FROM relationship_cycles rc
         JOIN relationships r ON r.id = rc.relationship_id
        WHERE r.local_account_id = ?
          AND rc.campaign_id = ?
          AND rc.origin = 'TOOL_CLICK'
          AND rc.followed_by_tool = 1
        ORDER BY rc.created_at, rc.id`,
    )
    .all(localAccountId, campaignId) as {
    profile_id: string;
    state: string;
    follow_back: string;
    follow_back_checked_at: string | null;
    followed_at: string | null;
    unfollowed_at: string | null;
  }[];

  const followedProfiles = new Set<string>();
  const unfollowedProfiles = new Set<string>();
  const openStateByProfile = new Map<string, string>();
  const latestFollowBackByProfile = new Map<string, { state: string; checkedAt: string | null }>();
  const firstFollowAtByProfile = new Map<string, string>();
  let unfollowEvents = 0;
  for (const row of cycleRows) {
    followedProfiles.add(row.profile_id);
    latestFollowBackByProfile.set(row.profile_id, {
      state: row.follow_back,
      checkedAt: row.follow_back_checked_at,
    });
    if (row.followed_at && !firstFollowAtByProfile.has(row.profile_id)) {
      firstFollowAtByProfile.set(row.profile_id, row.followed_at);
    }
    if (row.unfollowed_at) {
      unfollowedProfiles.add(row.profile_id);
      unfollowEvents += 1;
    } else {
      openStateByProfile.set(row.profile_id, row.state);
    }
  }

  let following = 0;
  let requested = 0;
  for (const state of openStateByProfile.values()) {
    if (state === 'FOLLOWING') following += 1;
    else if (state === 'FOLLOW_REQUESTED') requested += 1;
  }

  const followBacks = {
    yes: 0,
    no: 0,
    unknown: 0,
    checked: 0,
    classified: 0,
    uninspected: 0,
    total: followedProfiles.size,
    coveragePct: null as number | null,
  };
  for (const observation of latestFollowBackByProfile.values()) {
    if (observation.state === 'YES') followBacks.yes += 1;
    else if (observation.state === 'NO') followBacks.no += 1;
    else followBacks.unknown += 1;
    if (observation.checkedAt) followBacks.checked += 1;
  }
  followBacks.classified = followBacks.yes + followBacks.no;
  followBacks.uninspected = followBacks.total - followBacks.checked;
  followBacks.coveragePct = percentage(followBacks.checked, followBacks.total);

  const snapshotRepo = new FollowerSnapshotRepo(db);
  const completeSnapshots = snapshotRepo.listComplete(localAccountId);
  const latestSnapshot = completeSnapshots.at(-1);
  const membersBySnapshot = new Map(
    completeSnapshots.map((snapshot) => [
      snapshot.id,
      snapshotRepo.memberProfileIds(snapshot.id),
    ]),
  );
  const latestMembers = latestSnapshot
    ? (membersBySnapshot.get(latestSnapshot.id) ?? new Set<string>())
    : null;
  let currentFollowersFromCampaign = 0;
  if (latestMembers) {
    for (const profileId of followedProfiles) {
      if (latestMembers.has(profileId)) currentFollowersFromCampaign += 1;
    }
  }

  let confirmedNewFollowers = 0;
  let eligibleWithBaseline = 0;
  let attributionUnknown = 0;
  if (latestSnapshot && latestMembers) {
    const latestObservedMs = Date.parse(latestSnapshot.observedAt);
    for (const profileId of followedProfiles) {
      const followedAt = firstFollowAtByProfile.get(profileId);
      const followedAtMs = followedAt ? Date.parse(followedAt) : Number.NaN;
      if (!Number.isFinite(followedAtMs) || latestObservedMs < followedAtMs) {
        attributionUnknown += 1;
        continue;
      }
      let baseline: (typeof completeSnapshots)[number] | undefined;
      for (let index = completeSnapshots.length - 1; index >= 0; index -= 1) {
        const candidate = completeSnapshots[index];
        if (candidate && Date.parse(candidate.observedAt) <= followedAtMs) {
          baseline = candidate;
          break;
        }
      }
      if (!baseline) {
        attributionUnknown += 1;
        continue;
      }
      const baselineMembers = membersBySnapshot.get(baseline.id) ?? new Set<string>();
      if (baselineMembers.has(profileId)) continue;

      eligibleWithBaseline += 1;
      if (latestMembers.has(profileId)) confirmedNewFollowers += 1;
    }
  } else {
    attributionUnknown = followedProfiles.size;
  }

  const attemptRows = db
    .prepare(
      `SELECT a.profile_id AS profile_id, a.state AS state, a.created_at AS created_at
         FROM action_attempts a
         JOIN campaign_candidates c ON c.profile_id = a.profile_id
        WHERE c.campaign_id = ?
          AND a.local_account_id = ?
          AND a.action_type = 'FOLLOW'
        ORDER BY a.created_at, a.id`,
    )
    .all(campaignId, localAccountId) as {
    profile_id: string;
    state: string;
    created_at: string;
  }[];
  const latestByProfile = new Map<string, string>();
  for (const row of attemptRows) {
    latestByProfile.set(row.profile_id, row.state);
  }
  const latestFollowAttempts = {
    confirmed: 0,
    ambiguous: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    total: latestByProfile.size,
  };
  for (const state of latestByProfile.values()) {
    if (state === 'CONFIRMED') latestFollowAttempts.confirmed += 1;
    else if (state === 'AMBIGUOUS') latestFollowAttempts.ambiguous += 1;
    else if (state === 'FAILED') latestFollowAttempts.failed += 1;
    else if (state === 'SKIPPED') latestFollowAttempts.skipped += 1;
    else latestFollowAttempts.pending += 1;
  }

  const planningCandidates = loadFollowCandidates(db, campaignId, localAccountId);
  const preview = buildFollowPreview(planningCandidates);
  const unattemptedPreview = buildFollowPreview(planningCandidates, {
    onlyUnattempted: true,
  });

  return {
    candidates: { total: allCandidates.length, bySource, byState },
    postsWithSignals,
    engagementSignals,
    currentRelationships: {
      following,
      requested,
      total: following + requested,
    },
    relationshipHistory: {
      toolFollowed: followedProfiles.size,
      followCycles: cycleRows.length,
      unfollowed: unfollowedProfiles.size,
      unfollowEvents,
    },
    followBacks,
    followersSnapshot: latestSnapshot
      ? {
          id: latestSnapshot.id,
          observedAt: latestSnapshot.observedAt,
          currentTotal: latestMembers?.size ?? 0,
          currentFromCampaign: currentFollowersFromCampaign,
        }
      : null,
    conversion: {
      followers: latestSnapshot ? currentFollowersFromCampaign : followBacks.yes,
      confirmedToolFollows: followedProfiles.size,
      ratePct: latestSnapshot
        ? percentage(currentFollowersFromCampaign, followedProfiles.size)
        : followBacks.checked === 0
          ? null
          : percentage(followBacks.yes, followedProfiles.size),
      confirmedNewFollowers,
      eligibleWithBaseline,
      confirmedRatePct: percentage(confirmedNewFollowers, eligibleWithBaseline),
      attributionUnknown,
    },
    latestFollowAttempts,
    remaining: {
      eligible: preview.totalProposed,
      neverAttempted: unattemptedPreview.totalProposed,
    },
    excluded: {
      whitelisted: preview.excluded.whitelisted,
      protected: preview.excluded.protected,
      alreadyFollowing: preview.excluded.already_following,
      previouslyAttempted: unattemptedPreview.excluded.previously_attempted,
    },
  };
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

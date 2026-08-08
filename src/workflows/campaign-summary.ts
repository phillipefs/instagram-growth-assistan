import type { SqliteDatabase } from '../database/connection.js';
import { CampaignCandidateRepo } from '../database/repositories/campaigns.js';
import { buildFollowPreview, loadFollowCandidates } from './plan-follow.js';

export interface CampaignSummary {
  readonly candidates: {
    readonly total: number;
    readonly bySource: Record<string, number>;
    readonly byState: Record<string, number>;
  };
  readonly engagementSignals: Record<string, number>;
  readonly currentRelationships: {
    readonly following: number;
    readonly requested: number;
    readonly total: number;
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

  const relationshipCounts = db
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN rc.state = 'FOLLOWING' THEN c.profile_id END) AS following,
         COUNT(DISTINCT CASE WHEN rc.state = 'FOLLOW_REQUESTED' THEN c.profile_id END) AS requested
       FROM campaign_candidates c
       JOIN relationships r
         ON r.profile_id = c.profile_id AND r.local_account_id = ?
       JOIN relationship_cycles rc
         ON rc.relationship_id = r.id AND rc.unfollowed_at IS NULL
       WHERE c.campaign_id = ?`,
    )
    .get(localAccountId, campaignId) as { following: number; requested: number };

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
    engagementSignals,
    currentRelationships: {
      following: relationshipCounts.following,
      requested: relationshipCounts.requested,
      total: relationshipCounts.following + relationshipCounts.requested,
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

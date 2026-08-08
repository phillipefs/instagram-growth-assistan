import type { SqliteDatabase } from '../database/connection.js';
import type { Profile } from '../database/repositories/profiles.js';
import { TargetObservationRepo } from '../database/repositories/target-observations.js';

export interface TargetSummary {
  readonly target: {
    readonly username: string;
    readonly profileUrl: string | null;
  };
  readonly campaigns: {
    readonly total: number;
    readonly items: readonly { readonly name: string; readonly status: string }[];
  };
  readonly instagramReportedPosts: number | null;
  readonly instagramReportedPostsObservedAt: string | null;
  readonly collection: {
    readonly postsObserved: number;
    readonly postsWithSignals: number;
    readonly postsWithPublishedAt: number;
    readonly newestPostPublishedAt: string | null;
    readonly oldestPostPublishedAt: string | null;
    readonly uniqueCandidates: number;
    readonly engagementSignals: {
      readonly total: number;
      readonly byType: Record<string, number>;
    };
    readonly firstObservedAt: string | null;
    readonly lastObservedAt: string | null;
  };
}

/** Visão somente leitura e independente de campanha para um perfil-alvo. */
export function buildTargetSummary(db: SqliteDatabase, target: Profile): TargetSummary {
  const campaigns = db
    .prepare(
      `SELECT name, status
         FROM campaigns
        WHERE target_profile_id = ?
        ORDER BY created_at, id`,
    )
    .all(target.id) as { name: string; status: string }[];

  const media = db
    .prepare(
      `SELECT COUNT(*) AS observed,
              COUNT(published_at) AS dated,
              MAX(published_at) AS newest,
              MIN(published_at) AS oldest,
              MIN(first_seen_at) AS first_seen,
              MAX(last_seen_at) AS last_seen
         FROM media
        WHERE profile_id = ?`,
    )
    .get(target.id) as {
    observed: number;
    dated: number;
    newest: string | null;
    oldest: string | null;
    first_seen: string | null;
    last_seen: string | null;
  };

  const postsWithSignals = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT s.media_shortcode) AS n
           FROM candidate_signals s
           JOIN campaign_candidates cc ON cc.id = s.campaign_candidate_id
           JOIN campaigns c ON c.id = cc.campaign_id
          WHERE c.target_profile_id = ? AND s.media_shortcode IS NOT NULL`,
      )
      .get(target.id) as { n: number }
  ).n;

  const uniqueCandidates = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT cc.profile_id) AS n
           FROM campaign_candidates cc
           JOIN campaigns c ON c.id = cc.campaign_id
          WHERE c.target_profile_id = ?`,
      )
      .get(target.id) as { n: number }
  ).n;

  const signalRows = db
    .prepare(
      `SELECT type, COUNT(*) AS n
         FROM (
           SELECT DISTINCT cc.profile_id AS profile_id,
                           s.type AS type,
                           IFNULL(s.media_shortcode, '') AS media_shortcode
             FROM candidate_signals s
             JOIN campaign_candidates cc ON cc.id = s.campaign_candidate_id
             JOIN campaigns c ON c.id = cc.campaign_id
            WHERE c.target_profile_id = ?
         )
        GROUP BY type
        ORDER BY type`,
    )
    .all(target.id) as { type: string; n: number }[];
  const byType: Record<string, number> = {};
  let totalSignals = 0;
  for (const row of signalRows) {
    byType[row.type] = row.n;
    totalSignals += row.n;
  }

  const observationRange = db
    .prepare(
      `SELECT MIN(observed_at) AS first_seen, MAX(observed_at) AS last_seen
         FROM target_profile_observations
        WHERE profile_id = ?`,
    )
    .get(target.id) as { first_seen: string | null; last_seen: string | null };
  const latest = new TargetObservationRepo(db).latest(target.id);
  const firstObservedAt =
    [media.first_seen, observationRange.first_seen]
      .filter((value): value is string => value !== null)
      .sort()[0] ?? null;
  const lastObservedAt =
    [media.last_seen, observationRange.last_seen]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;

  return {
    target: {
      username: target.usernameCanonical,
      profileUrl: target.profileUrl,
    },
    campaigns: { total: campaigns.length, items: campaigns },
    instagramReportedPosts: latest?.instagramReportedPosts ?? null,
    instagramReportedPostsObservedAt: latest?.observedAt ?? null,
    collection: {
      postsObserved: media.observed,
      postsWithSignals,
      postsWithPublishedAt: media.dated,
      newestPostPublishedAt: media.newest,
      oldestPostPublishedAt: media.oldest,
      uniqueCandidates,
      engagementSignals: { total: totalSignals, byType },
      firstObservedAt,
      lastObservedAt,
    },
  };
}

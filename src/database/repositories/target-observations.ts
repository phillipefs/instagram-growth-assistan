import type { SqliteDatabase } from '../connection.js';
import { newId, nowIso } from '../util.js';

export interface TargetProfileObservation {
  readonly id: string;
  readonly profileId: string;
  readonly instagramReportedPosts: number | null;
  readonly observedAt: string;
}

interface ObservationRow {
  readonly id: string;
  readonly profile_id: string;
  readonly instagram_reported_posts: number | null;
  readonly observed_at: string;
}

function mapRow(row: ObservationRow): TargetProfileObservation {
  return {
    id: row.id,
    profileId: row.profile_id,
    instagramReportedPosts: row.instagram_reported_posts,
    observedAt: row.observed_at,
  };
}

export class TargetObservationRepo {
  constructor(private readonly db: SqliteDatabase) {}

  record(profileId: string, instagramReportedPosts: number | null): TargetProfileObservation {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO target_profile_observations
           (id, profile_id, instagram_reported_posts, observed_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, profileId, instagramReportedPosts, nowIso());
    const row = this.db
      .prepare('SELECT * FROM target_profile_observations WHERE id = ?')
      .get(id) as ObservationRow;
    return mapRow(row);
  }

  latest(profileId: string): TargetProfileObservation | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM target_profile_observations
          WHERE profile_id = ?
          ORDER BY observed_at DESC, id DESC
          LIMIT 1`,
      )
      .get(profileId) as ObservationRow | undefined;
    return row ? mapRow(row) : undefined;
  }
}

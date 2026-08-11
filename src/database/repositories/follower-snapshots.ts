import type { SqliteDatabase } from '../connection.js';
import { newId, nowIso } from '../util.js';

export type FollowerSnapshotStatus = 'COMPLETE' | 'TOLERATED' | 'INCOMPLETE';

export interface FollowerSnapshot {
  readonly id: string;
  readonly localAccountId: string;
  readonly status: FollowerSnapshotStatus;
  readonly expectedCount: number | null;
  readonly loadedCount: number;
  readonly observedAt: string;
  readonly completedAt: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
}

interface SnapshotRow {
  readonly id: string;
  readonly local_account_id: string;
  readonly status: string;
  readonly expected_count: number | null;
  readonly loaded_count: number;
  readonly observed_at: string;
  readonly completed_at: string | null;
  readonly failure_reason: string | null;
  readonly created_at: string;
}

function mapSnapshot(row: SnapshotRow): FollowerSnapshot {
  return {
    id: row.id,
    localAccountId: row.local_account_id,
    status: row.status as FollowerSnapshotStatus,
    expectedCount: row.expected_count,
    loadedCount: row.loaded_count,
    observedAt: row.observed_at,
    completedAt: row.completed_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

export class FollowerSnapshotRepo {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    localAccountId: string;
    status: FollowerSnapshotStatus;
    expectedCount: number | null;
    loadedCount: number;
    observedAt: string;
    failureReason?: string;
  }): FollowerSnapshot {
    const id = newId();
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO follower_snapshots
           (id, local_account_id, status, expected_count, loaded_count, observed_at,
            completed_at, failure_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.localAccountId,
        input.status,
        input.expectedCount,
        input.loadedCount,
        input.observedAt,
        input.status !== 'INCOMPLETE' ? input.observedAt : null,
        input.failureReason ?? null,
        createdAt,
      );
    return this.getOrThrow(id);
  }

  get(id: string): FollowerSnapshot | undefined {
    const row = this.db.prepare('SELECT * FROM follower_snapshots WHERE id = ?').get(id) as
      SnapshotRow | undefined;
    return row ? mapSnapshot(row) : undefined;
  }

  getOrThrow(id: string): FollowerSnapshot {
    const snapshot = this.get(id);
    if (!snapshot) throw new Error(`Snapshot de seguidores não encontrado: ${id}`);
    return snapshot;
  }

  latestComplete(localAccountId: string): FollowerSnapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM follower_snapshots
          WHERE local_account_id = ? AND status = 'COMPLETE'
          ORDER BY observed_at DESC, created_at DESC
          LIMIT 1`,
      )
      .get(localAccountId) as SnapshotRow | undefined;
    return row ? mapSnapshot(row) : undefined;
  }

  /** Snapshot mais recente aceito para planejamento: exato ou dentro da tolerância. */
  latestAccepted(localAccountId: string): FollowerSnapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM follower_snapshots
          WHERE local_account_id = ? AND status IN ('COMPLETE', 'TOLERATED')
          ORDER BY observed_at DESC, created_at DESC
          LIMIT 1`,
      )
      .get(localAccountId) as SnapshotRow | undefined;
    return row ? mapSnapshot(row) : undefined;
  }

  list(localAccountId: string, limit = 20): FollowerSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM follower_snapshots
          WHERE local_account_id = ?
          ORDER BY observed_at DESC, created_at DESC
          LIMIT ?`,
      )
      .all(localAccountId, Math.max(1, limit)) as SnapshotRow[];
    return rows.map(mapSnapshot);
  }

  listComplete(localAccountId: string): FollowerSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM follower_snapshots
          WHERE local_account_id = ? AND status = 'COMPLETE'
          ORDER BY observed_at, created_at`,
      )
      .all(localAccountId) as SnapshotRow[];
    return rows.map(mapSnapshot);
  }

  addMember(input: { snapshotId: string; profileId: string; observedUsername: string }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO follower_snapshot_members
           (snapshot_id, profile_id, observed_username, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.snapshotId, input.profileId, input.observedUsername, nowIso());
  }

  memberProfileIds(snapshotId: string): Set<string> {
    const rows = this.db
      .prepare('SELECT profile_id FROM follower_snapshot_members WHERE snapshot_id = ?')
      .all(snapshotId) as { profile_id: string }[];
    return new Set(rows.map((row) => row.profile_id));
  }

  isMember(snapshotId: string, profileId: string): boolean {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM follower_snapshot_members WHERE snapshot_id = ? AND profile_id = ? LIMIT 1',
        )
        .get(snapshotId, profileId) !== undefined
    );
  }

  /** Atualiza o cache de follow-back dos ciclos abertos a partir do snapshot completo. */
  materializeOpenFollowBacks(
    snapshotId: string,
    localAccountId: string,
    observedAt: string,
  ): number {
    const result = this.db
      .prepare(
        `UPDATE relationship_cycles AS rc
            SET follow_back = CASE WHEN EXISTS (
                  SELECT 1
                    FROM relationships member_relationship
                    JOIN follower_snapshot_members member
                      ON member.profile_id = member_relationship.profile_id
                   WHERE member_relationship.id = rc.relationship_id
                     AND member.snapshot_id = @snapshot
                ) THEN 'YES' ELSE 'NO' END,
                follow_back_checked_at = @observed,
                updated_at = @observed
          WHERE rc.unfollowed_at IS NULL
            AND EXISTS (
              SELECT 1 FROM relationships owner_relationship
               WHERE owner_relationship.id = rc.relationship_id
                 AND owner_relationship.local_account_id = @account
            )`,
      )
      .run({ snapshot: snapshotId, account: localAccountId, observed: observedAt });
    return result.changes;
  }

  /**
   * Em snapshot tolerado, confirma apenas presenças. Ausências não são
   * reclassificadas nem têm a observação renovada.
   */
  materializeToleratedOpenFollowBacks(
    snapshotId: string,
    localAccountId: string,
    observedAt: string,
  ): number {
    const result = this.db
      .prepare(
        `UPDATE relationship_cycles AS rc
            SET follow_back = 'YES',
                follow_back_checked_at = @observed,
                updated_at = @observed
          WHERE rc.unfollowed_at IS NULL
            AND EXISTS (
              SELECT 1 FROM relationships owner_relationship
               WHERE owner_relationship.id = rc.relationship_id
                 AND owner_relationship.local_account_id = @account
            )
            AND EXISTS (
              SELECT 1
                FROM relationships member_relationship
                JOIN follower_snapshot_members member
                  ON member.profile_id = member_relationship.profile_id
               WHERE member_relationship.id = rc.relationship_id
                 AND member.snapshot_id = @snapshot
            )`,
      )
      .run({ snapshot: snapshotId, account: localAccountId, observed: observedAt });
    return result.changes;
  }
}

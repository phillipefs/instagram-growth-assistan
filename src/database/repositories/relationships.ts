import type { SqliteDatabase } from '../connection.js';
import type {
  FollowBackState,
  RelationshipOrigin,
  RelationshipState,
} from '../../domain/states.js';
import { boolToInt, intToBool, newId, nowIso } from '../util.js';

export interface Relationship {
  readonly id: string;
  readonly localAccountId: string;
  readonly profileId: string;
  readonly whitelisted: boolean;
  readonly protected: boolean;
  readonly protectedReason: string | null;
}

interface RelationshipRow {
  readonly id: string;
  readonly local_account_id: string;
  readonly profile_id: string;
  readonly whitelisted: number;
  readonly protected: number;
  readonly protected_reason: string | null;
}

function mapRelationship(row: RelationshipRow): Relationship {
  return {
    id: row.id,
    localAccountId: row.local_account_id,
    profileId: row.profile_id,
    whitelisted: intToBool(row.whitelisted),
    protected: intToBool(row.protected),
    protectedReason: row.protected_reason,
  };
}

export interface RelationshipCycle {
  readonly id: string;
  readonly relationshipId: string;
  readonly state: RelationshipState;
  readonly origin: RelationshipOrigin;
  readonly campaignId: string | null;
  readonly followRunId: string | null;
  readonly followedByTool: boolean;
  readonly followRequestedAt: string | null;
  readonly followedAt: string | null;
  readonly followBack: FollowBackState;
  readonly followBackCheckedAt: string | null;
  readonly unfollowedAt: string | null;
  readonly unfollowReason: string | null;
}

interface CycleRow {
  readonly id: string;
  readonly relationship_id: string;
  readonly state: string;
  readonly origin: string;
  readonly campaign_id: string | null;
  readonly follow_run_id: string | null;
  readonly followed_by_tool: number;
  readonly follow_requested_at: string | null;
  readonly followed_at: string | null;
  readonly follow_back: string;
  readonly follow_back_checked_at: string | null;
  readonly unfollowed_at: string | null;
  readonly unfollow_reason: string | null;
}

function mapCycle(row: CycleRow): RelationshipCycle {
  return {
    id: row.id,
    relationshipId: row.relationship_id,
    state: row.state as RelationshipState,
    origin: row.origin as RelationshipOrigin,
    campaignId: row.campaign_id,
    followRunId: row.follow_run_id,
    followedByTool: intToBool(row.followed_by_tool),
    followRequestedAt: row.follow_requested_at,
    followedAt: row.followed_at,
    followBack: row.follow_back as FollowBackState,
    followBackCheckedAt: row.follow_back_checked_at,
    unfollowedAt: row.unfollowed_at,
    unfollowReason: row.unfollow_reason,
  };
}

export class RelationshipRepo {
  constructor(private readonly db: SqliteDatabase) {}

  /** Garante o vínculo (conta local, perfil) e o retorna. */
  ensure(localAccountId: string, profileId: string): Relationship {
    const existing = this.db
      .prepare('SELECT * FROM relationships WHERE local_account_id = ? AND profile_id = ?')
      .get(localAccountId, profileId) as RelationshipRow | undefined;
    if (existing) {
      return mapRelationship(existing);
    }
    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO relationships (id, local_account_id, profile_id, whitelisted, protected, created_at, updated_at)
         VALUES (?, ?, ?, 0, 0, ?, ?)`,
      )
      .run(id, localAccountId, profileId, now, now);
    const created = this.findById(id);
    if (!created) {
      throw new Error('Falha ao criar relacionamento.');
    }
    return created;
  }

  findById(id: string): Relationship | undefined {
    const row = this.db.prepare('SELECT * FROM relationships WHERE id = ?').get(id) as
      | RelationshipRow
      | undefined;
    return row ? mapRelationship(row) : undefined;
  }

  setProtection(id: string, isProtected: boolean, reason?: string): void {
    this.db
      .prepare('UPDATE relationships SET protected = ?, protected_reason = ?, updated_at = ? WHERE id = ?')
      .run(boolToInt(isProtected), reason ?? null, nowIso(), id);
  }

  setWhitelist(id: string, whitelisted: boolean): void {
    this.db
      .prepare('UPDATE relationships SET whitelisted = ?, updated_at = ? WHERE id = ?')
      .run(boolToInt(whitelisted), nowIso(), id);
  }

  /** Abre um ciclo de relacionamento (follow). `followed_by_tool` deriva da origem. */
  createCycle(input: {
    relationshipId: string;
    origin: RelationshipOrigin;
    state?: RelationshipState;
    campaignId?: string;
    followRunId?: string;
    followedAt?: string;
    followRequestedAt?: string;
  }): RelationshipCycle {
    const id = newId();
    const now = nowIso();
    const followedByTool = boolToInt(input.origin === 'TOOL_CLICK');
    this.db
      .prepare(
        `INSERT INTO relationship_cycles
           (id, relationship_id, state, origin, campaign_id, follow_run_id, followed_by_tool,
            follow_requested_at, followed_at, follow_back, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNKNOWN', ?, ?)`,
      )
      .run(
        id,
        input.relationshipId,
        input.state ?? 'FOLLOWING',
        input.origin,
        input.campaignId ?? null,
        input.followRunId ?? null,
        followedByTool,
        input.followRequestedAt ?? null,
        input.followedAt ?? now,
        now,
        now,
      );
    const created = this.findCycleById(id);
    if (!created) {
      throw new Error('Falha ao criar ciclo de relacionamento.');
    }
    return created;
  }

  findCycleById(id: string): RelationshipCycle | undefined {
    const row = this.db.prepare('SELECT * FROM relationship_cycles WHERE id = ?').get(id) as
      | CycleRow
      | undefined;
    return row ? mapCycle(row) : undefined;
  }

  /** Ciclo aberto (sem unfollow) do vínculo, se houver. */
  getOpenCycle(relationshipId: string): RelationshipCycle | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM relationship_cycles WHERE relationship_id = ? AND unfollowed_at IS NULL ORDER BY created_at DESC LIMIT 1',
      )
      .get(relationshipId) as CycleRow | undefined;
    return row ? mapCycle(row) : undefined;
  }

  setFollowBack(cycleId: string, value: FollowBackState): void {
    this.db
      .prepare('UPDATE relationship_cycles SET follow_back = ?, follow_back_checked_at = ?, updated_at = ? WHERE id = ?')
      .run(value, nowIso(), nowIso(), cycleId);
  }

  closeCycle(cycleId: string, input: { unfollowReason: string; unfollowedAt?: string }): void {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE relationship_cycles
            SET state = 'UNFOLLOWED', unfollowed_at = ?, unfollow_reason = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(input.unfollowedAt ?? now, input.unfollowReason, now, cycleId);
  }

  listCyclesByProfileId(profileId: string): RelationshipCycle[] {
    const rows = this.db
      .prepare(
        `SELECT rc.* FROM relationship_cycles rc
           JOIN relationships r ON r.id = rc.relationship_id
          WHERE r.profile_id = ?
          ORDER BY rc.created_at`,
      )
      .all(profileId) as CycleRow[];
    return rows.map(mapCycle);
  }
}

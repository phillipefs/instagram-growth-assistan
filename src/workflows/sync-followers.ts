import type { SqliteDatabase } from '../database/connection.js';
import { withTransaction } from '../database/connection.js';
import {
  FollowerSnapshotRepo,
  type FollowerSnapshot,
} from '../database/repositories/follower-snapshots.js';
import { ProfileRepo } from '../database/repositories/profiles.js';
import { canonicalUsername } from '../database/util.js';

export interface PersistFollowerSnapshotInput {
  readonly localAccountId: string;
  readonly complete: boolean;
  readonly expectedCount: number | null;
  readonly loadedCount: number;
  readonly usernames: readonly string[];
  readonly observedAt?: string;
  readonly reason: string;
}

export interface PersistFollowerSnapshotResult {
  readonly snapshot: FollowerSnapshot;
  readonly membersStored: number;
  readonly relationshipCyclesUpdated: number;
  readonly acceptedByTolerance: boolean;
}

export const FOLLOWER_SNAPSHOT_TOLERANCE_PCT = 1;

export function isWithinFollowerSnapshotTolerance(
  expectedCount: number | null,
  loadedCount: number,
): boolean {
  if (expectedCount === null || expectedCount <= 0 || loadedCount >= expectedCount) {
    return false;
  }
  return ((expectedCount - loadedCount) / expectedCount) * 100 <= FOLLOWER_SNAPSHOT_TOLERANCE_PCT;
}

/**
 * Persiste uma coleta de seguidores. Snapshots dentro da tolerância de 1%
 * confirmam somente YES; ausências permanecem UNKNOWN. Apenas snapshots exatos
 * podem materializar NO. Tudo ocorre em uma transação única.
 */
export function persistFollowerSnapshot(
  db: SqliteDatabase,
  input: PersistFollowerSnapshotInput,
): PersistFollowerSnapshotResult {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const snapshots = new FollowerSnapshotRepo(db);
  const acceptedByTolerance =
    !input.complete && isWithinFollowerSnapshotTolerance(input.expectedCount, input.loadedCount);
  if (!input.complete && !acceptedByTolerance) {
    const snapshot = snapshots.create({
      localAccountId: input.localAccountId,
      status: 'INCOMPLETE',
      expectedCount: input.expectedCount,
      loadedCount: input.loadedCount,
      observedAt,
      failureReason: input.reason,
    });
    return {
      snapshot,
      membersStored: 0,
      relationshipCyclesUpdated: 0,
      acceptedByTolerance: false,
    };
  }
  if (input.complete && (input.expectedCount === null || input.loadedCount < input.expectedCount)) {
    throw new Error('Snapshot marcado como completo sem alcançar o contador esperado.');
  }

  const canonicalUsernames = [...new Set(input.usernames.map(canonicalUsername))];
  if (canonicalUsernames.length !== input.loadedCount) {
    throw new Error(
      `Quantidade de usernames (${canonicalUsernames.length}) diverge da coleta (${input.loadedCount}).`,
    );
  }

  return withTransaction(db, () => {
    const profiles = new ProfileRepo(db);
    const members = canonicalUsernames.map((username) => profiles.upsert({ username }));
    const snapshot = snapshots.create({
      localAccountId: input.localAccountId,
      status: acceptedByTolerance ? 'TOLERATED' : 'COMPLETE',
      expectedCount: input.expectedCount,
      loadedCount: input.loadedCount,
      observedAt,
    });
    members.forEach((profile) => {
      snapshots.addMember({
        snapshotId: snapshot.id,
        profileId: profile.id,
        observedUsername: profile.usernameCanonical,
      });
    });
    const relationshipCyclesUpdated = acceptedByTolerance
      ? snapshots.materializeToleratedOpenFollowBacks(snapshot.id, input.localAccountId, observedAt)
      : snapshots.materializeOpenFollowBacks(snapshot.id, input.localAccountId, observedAt);
    return {
      snapshot,
      membersStored: members.length,
      relationshipCyclesUpdated,
      acceptedByTolerance,
    };
  });
}

import type { SqliteDatabase } from '../database/connection.js';
import { withTransaction } from '../database/connection.js';
import { FollowerSnapshotRepo, type FollowerSnapshot } from '../database/repositories/follower-snapshots.js';
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
}

/**
 * Persiste uma coleta de seguidores. Apenas snapshots completos recebem
 * membros e atualizam os ciclos; tudo ocorre em uma transação única.
 */
export function persistFollowerSnapshot(
  db: SqliteDatabase,
  input: PersistFollowerSnapshotInput,
): PersistFollowerSnapshotResult {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const snapshots = new FollowerSnapshotRepo(db);
  if (!input.complete) {
    const snapshot = snapshots.create({
      localAccountId: input.localAccountId,
      status: 'INCOMPLETE',
      expectedCount: input.expectedCount,
      loadedCount: input.loadedCount,
      observedAt,
      failureReason: input.reason,
    });
    return { snapshot, membersStored: 0, relationshipCyclesUpdated: 0 };
  }
  if (input.expectedCount === null || input.loadedCount < input.expectedCount) {
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
      status: 'COMPLETE',
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
    const relationshipCyclesUpdated = snapshots.materializeOpenFollowBacks(
      snapshot.id,
      input.localAccountId,
      observedAt,
    );
    return {
      snapshot,
      membersStored: members.length,
      relationshipCyclesUpdated,
    };
  });
}

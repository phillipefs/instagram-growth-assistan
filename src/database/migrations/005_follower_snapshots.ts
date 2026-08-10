import type { Migration } from '../migrator.js';

const SCHEMA = `
CREATE TABLE follower_snapshots (
  id TEXT PRIMARY KEY,
  local_account_id TEXT NOT NULL REFERENCES local_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  expected_count INTEGER,
  loaded_count INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  completed_at TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_follower_snapshots_account
  ON follower_snapshots(local_account_id, status, observed_at);

CREATE TABLE follower_snapshot_members (
  snapshot_id TEXT NOT NULL REFERENCES follower_snapshots(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  observed_username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, profile_id)
);
CREATE INDEX idx_follower_snapshot_members_profile
  ON follower_snapshot_members(profile_id, snapshot_id);
`;

export const migration005: Migration = {
  version: 5,
  name: 'follower_snapshots',
  up: (db) => {
    db.exec(SCHEMA);
  },
};

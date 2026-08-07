import type { Migration } from '../migrator.js';

const SCHEMA = `
CREATE TABLE local_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  username_canonical TEXT NOT NULL UNIQUE,
  profile_url TEXT,
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT,
  session_status TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  platform_id TEXT UNIQUE,
  username_canonical TEXT NOT NULL,
  username_display TEXT NOT NULL,
  profile_url TEXT,
  account_type TEXT,
  is_private INTEGER,
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT
);
CREATE INDEX idx_profiles_username ON profiles(username_canonical);

CREATE TABLE profile_aliases (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX idx_aliases_profile ON profile_aliases(profile_id);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  target_profile_id TEXT REFERENCES profiles(id),
  target_url TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE campaign_candidates (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'DISCOVERED',
  filter_reason TEXT,
  discovered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id, profile_id)
);
CREATE INDEX idx_candidates_campaign ON campaign_candidates(campaign_id);

CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  local_account_id TEXT NOT NULL REFERENCES local_accounts(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  whitelisted INTEGER NOT NULL DEFAULT 0,
  protected INTEGER NOT NULL DEFAULT 0,
  protected_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(local_account_id, profile_id)
);

CREATE TABLE relationship_cycles (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'NOT_FOLLOWING',
  origin TEXT NOT NULL,
  campaign_id TEXT REFERENCES campaigns(id),
  follow_run_id TEXT,
  followed_by_tool INTEGER NOT NULL DEFAULT 0,
  follow_requested_at TEXT,
  followed_at TEXT,
  follow_back TEXT NOT NULL DEFAULT 'UNKNOWN',
  follow_back_checked_at TEXT,
  unfollowed_at TEXT,
  unfollow_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_cycles_relationship ON relationship_cycles(relationship_id);
CREATE INDEX idx_cycles_open ON relationship_cycles(relationship_id, unfollowed_at);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shortcode TEXT NOT NULL UNIQUE,
  url TEXT,
  published_at TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'DRAFT',
  criteria_json TEXT NOT NULL,
  criteria_hash TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  frozen_at TEXT,
  invalidated_at TEXT,
  completed_at TEXT
);

CREATE TABLE plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  relationship_cycle_id TEXT REFERENCES relationship_cycles(id),
  campaign_id TEXT REFERENCES campaigns(id),
  eligibility_reason TEXT,
  snapshot_json TEXT,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(plan_id, profile_id)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  mode TEXT NOT NULL,
  local_account_id TEXT REFERENCES local_accounts(id),
  plan_id TEXT REFERENCES plans(id),
  config_json TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED',
  counters_json TEXT,
  stop_reason TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE action_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  local_account_id TEXT NOT NULL REFERENCES local_accounts(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  campaign_id TEXT REFERENCES campaigns(id),
  action_type TEXT NOT NULL,
  relationship_cycle_id TEXT REFERENCES relationship_cycles(id),
  plan_item_id TEXT REFERENCES plan_items(id),
  media_id TEXT REFERENCES media(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'PREPARED',
  prev_state TEXT,
  next_state TEXT,
  result TEXT,
  error_category TEXT,
  error_normalized TEXT,
  screenshot_path TEXT,
  trace_path TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_actions_run ON action_attempts(run_id);
CREATE INDEX idx_actions_profile ON action_attempts(profile_id);

CREATE TABLE safety_events (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  trigger TEXT NOT NULL,
  state TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE leases (
  key TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export const migration001: Migration = {
  version: 1,
  name: 'initial_schema',
  up: (db) => {
    db.exec(SCHEMA);
  },
};

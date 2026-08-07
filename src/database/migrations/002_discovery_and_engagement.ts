import type { Migration } from '../migrator.js';

const SCHEMA = `
ALTER TABLE campaign_candidates ADD COLUMN discovery_source TEXT NOT NULL DEFAULT 'FOLLOWERS';

CREATE TABLE candidate_signals (
  id TEXT PRIMARY KEY,
  campaign_candidate_id TEXT NOT NULL REFERENCES campaign_candidates(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  media_shortcode TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE(campaign_candidate_id, type, media_shortcode)
);
CREATE INDEX idx_candidate_signals_candidate ON candidate_signals(campaign_candidate_id);
`;

export const migration002: Migration = {
  version: 2,
  name: 'discovery_source_and_engagement_signals',
  up: (db) => {
    db.exec(SCHEMA);
  },
};

import type { Migration } from '../migrator.js';

const SCHEMA = `
ALTER TABLE media ADD COLUMN last_seen_at TEXT;
UPDATE media SET last_seen_at = first_seen_at WHERE last_seen_at IS NULL;

CREATE TABLE target_profile_observations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instagram_reported_posts INTEGER,
  observed_at TEXT NOT NULL
);
CREATE INDEX idx_target_observations_profile
  ON target_profile_observations(profile_id, observed_at);

-- Aproveita shortcodes já coletados antes desta migração. As datas continuarão
-- desconhecidas até que as publicações sejam revisitadas.
INSERT OR IGNORE INTO media
  (id, profile_id, shortcode, url, published_at, is_pinned, first_seen_at, last_seen_at)
SELECT lower(hex(randomblob(16))), MIN(c.target_profile_id), s.media_shortcode,
       'https://www.instagram.com/p/' || s.media_shortcode || '/',
       NULL, 0, MIN(s.observed_at), MAX(s.observed_at)
  FROM candidate_signals s
  JOIN campaign_candidates cc ON cc.id = s.campaign_candidate_id
  JOIN campaigns c ON c.id = cc.campaign_id
 WHERE c.target_profile_id IS NOT NULL
   AND s.media_shortcode IS NOT NULL
 GROUP BY s.media_shortcode
HAVING COUNT(DISTINCT c.target_profile_id) = 1;
`;

export const migration004: Migration = {
  version: 4,
  name: 'target_profile_and_media_observations',
  up: (db) => {
    db.exec(SCHEMA);
  },
};

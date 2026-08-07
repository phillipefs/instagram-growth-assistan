import type { Migration } from '../migrator.js';

const SCHEMA = `
CREATE TABLE action_reconciliations (
  id TEXT PRIMARY KEY,
  action_attempt_id TEXT NOT NULL UNIQUE REFERENCES action_attempts(id),
  resolution TEXT NOT NULL CHECK (resolution IN ('SKIP_NO_RETRY')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_action_reconciliations_attempt ON action_reconciliations(action_attempt_id);
`;

export const migration003: Migration = {
  version: 3,
  name: 'action_reconciliations',
  up: (db) => {
    db.exec(SCHEMA);
  },
};

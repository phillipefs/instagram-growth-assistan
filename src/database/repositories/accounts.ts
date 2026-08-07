import type { SqliteDatabase } from '../connection.js';
import { canonicalUsername, newId, nowIso } from '../util.js';

export interface LocalAccount {
  readonly id: string;
  readonly username: string;
  readonly usernameCanonical: string;
  readonly profileUrl: string | null;
  readonly firstSeenAt: string;
  readonly lastCheckedAt: string | null;
  readonly sessionStatus: string;
}

interface LocalAccountRow {
  readonly id: string;
  readonly username: string;
  readonly username_canonical: string;
  readonly profile_url: string | null;
  readonly first_seen_at: string;
  readonly last_checked_at: string | null;
  readonly session_status: string;
}

function mapRow(row: LocalAccountRow): LocalAccount {
  return {
    id: row.id,
    username: row.username,
    usernameCanonical: row.username_canonical,
    profileUrl: row.profile_url,
    firstSeenAt: row.first_seen_at,
    lastCheckedAt: row.last_checked_at,
    sessionStatus: row.session_status,
  };
}

export class LocalAccountRepo {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: { username: string; profileUrl?: string }): LocalAccount {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO local_accounts (id, username, username_canonical, profile_url, first_seen_at, session_status)
         VALUES (?, ?, ?, ?, ?, 'unknown')`,
      )
      .run(id, input.username, canonicalUsername(input.username), input.profileUrl ?? null, nowIso());
    const created = this.findById(id);
    if (!created) {
      throw new Error('Falha ao criar conta local.');
    }
    return created;
  }

  findById(id: string): LocalAccount | undefined {
    const row = this.db.prepare('SELECT * FROM local_accounts WHERE id = ?').get(id) as
      | LocalAccountRow
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByUsername(username: string): LocalAccount | undefined {
    const row = this.db
      .prepare('SELECT * FROM local_accounts WHERE username_canonical = ?')
      .get(canonicalUsername(username)) as LocalAccountRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(): LocalAccount[] {
    const rows = this.db
      .prepare('SELECT * FROM local_accounts ORDER BY first_seen_at')
      .all() as LocalAccountRow[];
    return rows.map(mapRow);
  }

  touchChecked(id: string, sessionStatus?: string): void {
    this.db
      .prepare('UPDATE local_accounts SET last_checked_at = ?, session_status = COALESCE(?, session_status) WHERE id = ?')
      .run(nowIso(), sessionStatus ?? null, id);
  }
}

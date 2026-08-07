import type { SqliteDatabase } from '../connection.js';
import { boolToInt, canonicalUsername, intToBool, newId, nowIso } from '../util.js';

export interface Profile {
  readonly id: string;
  readonly platformId: string | null;
  readonly usernameCanonical: string;
  readonly usernameDisplay: string;
  readonly profileUrl: string | null;
  readonly accountType: string | null;
  readonly isPrivate: boolean | null;
  readonly firstSeenAt: string;
  readonly lastCheckedAt: string | null;
}

interface ProfileRow {
  readonly id: string;
  readonly platform_id: string | null;
  readonly username_canonical: string;
  readonly username_display: string;
  readonly profile_url: string | null;
  readonly account_type: string | null;
  readonly is_private: number | null;
  readonly first_seen_at: string;
  readonly last_checked_at: string | null;
}

function mapRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    platformId: row.platform_id,
    usernameCanonical: row.username_canonical,
    usernameDisplay: row.username_display,
    profileUrl: row.profile_url,
    accountType: row.account_type,
    isPrivate: row.is_private === null ? null : intToBool(row.is_private),
    firstSeenAt: row.first_seen_at,
    lastCheckedAt: row.last_checked_at,
  };
}

export interface UpsertProfileInput {
  readonly username: string;
  readonly platformId?: string;
  readonly profileUrl?: string;
  readonly accountType?: string;
  readonly isPrivate?: boolean;
}

export class ProfileRepo {
  constructor(private readonly db: SqliteDatabase) {}

  findById(id: string): Profile | undefined {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as
      | ProfileRow
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByUsername(username: string): Profile | undefined {
    const row = this.db
      .prepare('SELECT * FROM profiles WHERE username_canonical = ? ORDER BY first_seen_at LIMIT 1')
      .get(canonicalUsername(username)) as ProfileRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByPlatformId(platformId: string): Profile | undefined {
    const row = this.db.prepare('SELECT * FROM profiles WHERE platform_id = ?').get(platformId) as
      | ProfileRow
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(): Profile[] {
    const rows = this.db.prepare('SELECT * FROM profiles ORDER BY first_seen_at').all() as ProfileRow[];
    return rows.map(mapRow);
  }

  private recordAlias(profileId: string, username: string): void {
    this.db
      .prepare('INSERT INTO profile_aliases (id, profile_id, username, observed_at) VALUES (?, ?, ?, ?)')
      .run(newId(), profileId, username, nowIso());
  }

  /**
   * Cria ou atualiza um perfil. Prioriza o `platformId` estável quando presente;
   * caso contrário, usa o username canônico. Renomeações geram um alias.
   */
  upsert(input: UpsertProfileInput): Profile {
    const canonical = canonicalUsername(input.username);
    const existing = input.platformId
      ? this.findByPlatformId(input.platformId)
      : this.findByUsername(canonical);

    if (existing) {
      if (existing.usernameCanonical !== canonical) {
        this.recordAlias(existing.id, input.username);
      }
      this.db
        .prepare(
          `UPDATE profiles
             SET username_canonical = ?, username_display = ?,
                 profile_url = COALESCE(?, profile_url),
                 account_type = COALESCE(?, account_type),
                 is_private = COALESCE(?, is_private),
                 platform_id = COALESCE(?, platform_id),
                 last_checked_at = ?
           WHERE id = ?`,
        )
        .run(
          canonical,
          input.username,
          input.profileUrl ?? null,
          input.accountType ?? null,
          input.isPrivate === undefined ? null : boolToInt(input.isPrivate),
          input.platformId ?? null,
          nowIso(),
          existing.id,
        );
      const updated = this.findById(existing.id);
      if (!updated) {
        throw new Error('Falha ao atualizar perfil.');
      }
      return updated;
    }

    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO profiles
           (id, platform_id, username_canonical, username_display, profile_url, account_type, is_private, first_seen_at, last_checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.platformId ?? null,
        canonical,
        input.username,
        input.profileUrl ?? null,
        input.accountType ?? null,
        input.isPrivate === undefined ? null : boolToInt(input.isPrivate),
        now,
        now,
      );
    this.recordAlias(id, input.username);
    const created = this.findById(id);
    if (!created) {
      throw new Error('Falha ao criar perfil.');
    }
    return created;
  }
}

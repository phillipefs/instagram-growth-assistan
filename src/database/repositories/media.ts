import type { SqliteDatabase } from '../connection.js';
import { boolToInt, intToBool, newId, nowIso } from '../util.js';

export interface Media {
  readonly id: string;
  readonly profileId: string;
  readonly shortcode: string;
  readonly url: string | null;
  readonly publishedAt: string | null;
  readonly isPinned: boolean;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

interface MediaRow {
  readonly id: string;
  readonly profile_id: string;
  readonly shortcode: string;
  readonly url: string | null;
  readonly published_at: string | null;
  readonly is_pinned: number;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
}

function mapRow(row: MediaRow): Media {
  return {
    id: row.id,
    profileId: row.profile_id,
    shortcode: row.shortcode,
    url: row.url,
    publishedAt: row.published_at,
    isPinned: intToBool(row.is_pinned),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export class MediaRepo {
  constructor(private readonly db: SqliteDatabase) {}

  findByShortcode(shortcode: string): Media | undefined {
    const row = this.db.prepare('SELECT * FROM media WHERE shortcode = ?').get(shortcode) as
      MediaRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  upsert(input: {
    profileId: string;
    shortcode: string;
    url?: string;
    publishedAt?: string;
    isPinned?: boolean;
  }): Media {
    const existing = this.findByShortcode(input.shortcode);
    if (existing) {
      if (existing.profileId !== input.profileId) {
        throw new Error(`Divergência de proprietário da mídia ${input.shortcode}.`);
      }
      this.db
        .prepare(
          `UPDATE media
              SET url = COALESCE(?, url),
                  published_at = COALESCE(?, published_at),
                  is_pinned = CASE WHEN ? = 1 THEN 1 ELSE is_pinned END,
                  last_seen_at = ?
            WHERE id = ?`,
        )
        .run(
          input.url ?? null,
          input.publishedAt ?? null,
          boolToInt(input.isPinned ?? false),
          nowIso(),
          existing.id,
        );
      return this.findByShortcode(input.shortcode) as Media;
    }
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO media
           (id, profile_id, shortcode, url, published_at, is_pinned, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.profileId,
        input.shortcode,
        input.url ?? null,
        input.publishedAt ?? null,
        boolToInt(input.isPinned ?? false),
        nowIso(),
        nowIso(),
      );
    const created = this.findByShortcode(input.shortcode);
    if (!created) {
      throw new Error('Falha ao registrar mídia.');
    }
    return created;
  }
}

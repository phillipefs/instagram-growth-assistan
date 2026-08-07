import type { SqliteDatabase } from '../connection.js';
import type { CampaignCandidateState } from '../../domain/states.js';
import type { DiscoverySource } from '../../domain/discovery.js';
import { newId, nowIso } from '../util.js';

export interface Campaign {
  readonly id: string;
  readonly name: string;
  readonly targetProfileId: string | null;
  readonly targetUrl: string | null;
  readonly description: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CampaignRow {
  readonly id: string;
  readonly name: string;
  readonly target_profile_id: string | null;
  readonly target_url: string | null;
  readonly description: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    targetProfileId: row.target_profile_id,
    targetUrl: row.target_url,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CampaignRepo {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    name: string;
    targetProfileId?: string;
    targetUrl?: string;
    description?: string;
  }): Campaign {
    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO campaigns (id, name, target_profile_id, target_url, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.targetProfileId ?? null,
        input.targetUrl ?? null,
        input.description ?? null,
        now,
        now,
      );
    const created = this.findById(id);
    if (!created) {
      throw new Error('Falha ao criar campanha.');
    }
    return created;
  }

  findById(id: string): Campaign | undefined {
    const row = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as
      | CampaignRow
      | undefined;
    return row ? mapCampaign(row) : undefined;
  }

  findByName(name: string): Campaign | undefined {
    const row = this.db.prepare('SELECT * FROM campaigns WHERE name = ?').get(name) as
      | CampaignRow
      | undefined;
    return row ? mapCampaign(row) : undefined;
  }

  list(): Campaign[] {
    const rows = this.db.prepare('SELECT * FROM campaigns ORDER BY created_at').all() as CampaignRow[];
    return rows.map(mapCampaign);
  }
}

export interface CampaignCandidate {
  readonly id: string;
  readonly campaignId: string;
  readonly profileId: string;
  readonly state: CampaignCandidateState;
  readonly discoverySource: DiscoverySource;
  readonly filterReason: string | null;
  readonly discoveredAt: string;
}

interface CandidateRow {
  readonly id: string;
  readonly campaign_id: string;
  readonly profile_id: string;
  readonly state: string;
  readonly discovery_source: string;
  readonly filter_reason: string | null;
  readonly discovered_at: string;
}

function mapCandidate(row: CandidateRow): CampaignCandidate {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    profileId: row.profile_id,
    state: row.state as CampaignCandidateState,
    discoverySource: row.discovery_source as DiscoverySource,
    filterReason: row.filter_reason,
    discoveredAt: row.discovered_at,
  };
}

export interface CandidateWithUsername extends CampaignCandidate {
  readonly username: string;
}

export class CampaignCandidateRepo {
  constructor(private readonly db: SqliteDatabase) {}

  findByCampaignAndProfile(campaignId: string, profileId: string): CampaignCandidate | undefined {
    const row = this.db
      .prepare('SELECT * FROM campaign_candidates WHERE campaign_id = ? AND profile_id = ?')
      .get(campaignId, profileId) as CandidateRow | undefined;
    return row ? mapCandidate(row) : undefined;
  }

  /**
   * Adiciona um candidato à campanha. A deduplicação por (campanha, perfil) é
   * garantida: uma segunda inserção retorna o registro existente sem duplicar.
   */
  add(input: {
    campaignId: string;
    profileId: string;
    state?: CampaignCandidateState;
    discoverySource?: DiscoverySource;
    filterReason?: string;
  }): { created: boolean; candidate: CampaignCandidate } {
    const existing = this.findByCampaignAndProfile(input.campaignId, input.profileId);
    if (existing) {
      return { created: false, candidate: existing };
    }
    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO campaign_candidates
           (id, campaign_id, profile_id, state, discovery_source, filter_reason, discovered_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.campaignId,
        input.profileId,
        input.state ?? 'DISCOVERED',
        input.discoverySource ?? 'FOLLOWERS',
        input.filterReason ?? null,
        now,
        now,
        now,
      );
    const candidate = this.findByCampaignAndProfile(input.campaignId, input.profileId);
    if (!candidate) {
      throw new Error('Falha ao adicionar candidato.');
    }
    return { created: true, candidate };
  }

  setState(id: string, state: CampaignCandidateState, filterReason?: string): void {
    this.db
      .prepare('UPDATE campaign_candidates SET state = ?, filter_reason = COALESCE(?, filter_reason), updated_at = ? WHERE id = ?')
      .run(state, filterReason ?? null, nowIso(), id);
  }

  listByCampaign(campaignId: string): CandidateWithUsername[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, p.username_display AS username
           FROM campaign_candidates c
           JOIN profiles p ON p.id = c.profile_id
          WHERE c.campaign_id = ?
          ORDER BY c.discovered_at`,
      )
      .all(campaignId) as (CandidateRow & { username: string })[];
    return rows.map((row) => ({ ...mapCandidate(row), username: row.username }));
  }

  countByCampaign(campaignId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM campaign_candidates WHERE campaign_id = ?')
      .get(campaignId) as { n: number };
    return row.n;
  }
}

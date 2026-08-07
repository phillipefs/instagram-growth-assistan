import type { SqliteDatabase } from '../connection.js';
import type { EngagementType } from '../../domain/discovery.js';
import { newId, nowIso } from '../util.js';

export interface CandidateSignal {
  readonly id: string;
  readonly campaignCandidateId: string;
  readonly type: EngagementType;
  readonly mediaShortcode: string | null;
  readonly observedAt: string;
}

interface SignalRow {
  readonly id: string;
  readonly campaign_candidate_id: string;
  readonly type: string;
  readonly media_shortcode: string | null;
  readonly observed_at: string;
}

function mapRow(row: SignalRow): CandidateSignal {
  return {
    id: row.id,
    campaignCandidateId: row.campaign_candidate_id,
    type: row.type as EngagementType,
    mediaShortcode: row.media_shortcode,
    observedAt: row.observed_at,
  };
}

export class CandidateSignalRepo {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Registra um sinal de engajamento. Deduplicado por (candidato, tipo, mídia):
   * observar o mesmo sinal de novo não duplica.
   */
  record(input: {
    campaignCandidateId: string;
    type: EngagementType;
    mediaShortcode?: string;
  }): { created: boolean; signal: CandidateSignal } {
    const existing = this.db
      .prepare(
        'SELECT * FROM candidate_signals WHERE campaign_candidate_id = ? AND type = ? AND IFNULL(media_shortcode, \'\') = IFNULL(?, \'\')',
      )
      .get(input.campaignCandidateId, input.type, input.mediaShortcode ?? null) as
      | SignalRow
      | undefined;
    if (existing) {
      return { created: false, signal: mapRow(existing) };
    }
    const id = newId();
    this.db
      .prepare(
        'INSERT INTO candidate_signals (id, campaign_candidate_id, type, media_shortcode, observed_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.campaignCandidateId, input.type, input.mediaShortcode ?? null, nowIso());
    const signal = this.db.prepare('SELECT * FROM candidate_signals WHERE id = ?').get(id) as
      | SignalRow
      | undefined;
    if (!signal) {
      throw new Error('Falha ao registrar sinal de engajamento.');
    }
    return { created: true, signal: mapRow(signal) };
  }

  listByCandidate(campaignCandidateId: string): CandidateSignal[] {
    const rows = this.db
      .prepare('SELECT * FROM candidate_signals WHERE campaign_candidate_id = ? ORDER BY observed_at')
      .all(campaignCandidateId) as SignalRow[];
    return rows.map(mapRow);
  }
}

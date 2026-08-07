import type { SqliteDatabase } from '../connection.js';
import type { ActionState, ActionType } from '../../domain/states.js';
import { assertActionTransition } from '../../domain/action-attempt.js';
import { newId, nowIso } from '../util.js';

export interface ActionAttempt {
  readonly id: string;
  readonly runId: string | null;
  readonly localAccountId: string;
  readonly profileId: string;
  readonly campaignId: string | null;
  readonly actionType: ActionType;
  readonly relationshipCycleId: string | null;
  readonly planItemId: string | null;
  readonly mediaId: string | null;
  readonly idempotencyKey: string;
  readonly state: ActionState;
  readonly result: string | null;
  readonly errorCategory: string | null;
  readonly errorNormalized: string | null;
  readonly screenshotPath: string | null;
  readonly tracePath: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

interface ActionRow {
  readonly id: string;
  readonly run_id: string | null;
  readonly local_account_id: string;
  readonly profile_id: string;
  readonly campaign_id: string | null;
  readonly action_type: string;
  readonly relationship_cycle_id: string | null;
  readonly plan_item_id: string | null;
  readonly media_id: string | null;
  readonly idempotency_key: string;
  readonly state: string;
  readonly result: string | null;
  readonly error_category: string | null;
  readonly error_normalized: string | null;
  readonly screenshot_path: string | null;
  readonly trace_path: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
}

function mapRow(row: ActionRow): ActionAttempt {
  return {
    id: row.id,
    runId: row.run_id,
    localAccountId: row.local_account_id,
    profileId: row.profile_id,
    campaignId: row.campaign_id,
    actionType: row.action_type as ActionType,
    relationshipCycleId: row.relationship_cycle_id,
    planItemId: row.plan_item_id,
    mediaId: row.media_id,
    idempotencyKey: row.idempotency_key,
    state: row.state as ActionState,
    result: row.result,
    errorCategory: row.error_category,
    errorNormalized: row.error_normalized,
    screenshotPath: row.screenshot_path,
    tracePath: row.trace_path,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export interface PrepareActionInput {
  readonly localAccountId: string;
  readonly profileId: string;
  readonly actionType: ActionType;
  readonly idempotencyKey: string;
  readonly runId?: string;
  readonly campaignId?: string;
  readonly relationshipCycleId?: string;
  readonly planItemId?: string;
  readonly mediaId?: string;
}

export interface CompleteActionInput {
  readonly result?: string;
  readonly errorCategory?: string;
  readonly errorNormalized?: string;
  readonly screenshotPath?: string;
  readonly tracePath?: string;
}

export class ActionAttemptRepo {
  constructor(private readonly db: SqliteDatabase) {}

  findById(id: string): ActionAttempt | undefined {
    const row = this.db.prepare('SELECT * FROM action_attempts WHERE id = ?').get(id) as
      | ActionRow
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByIdempotencyKey(key: string): ActionAttempt | undefined {
    const row = this.db.prepare('SELECT * FROM action_attempts WHERE idempotency_key = ?').get(key) as
      | ActionRow
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * Registra a intenção da ação. Idempotente: se a chave já existe, retorna o
   * registro atual sem duplicar (`created = false`).
   */
  prepare(input: PrepareActionInput): { created: boolean; attempt: ActionAttempt } {
    const existing = this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { created: false, attempt: existing };
    }
    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO action_attempts
           (id, run_id, local_account_id, profile_id, campaign_id, action_type,
            relationship_cycle_id, plan_item_id, media_id, idempotency_key, state,
            started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARED', ?, ?, ?)`,
      )
      .run(
        id,
        input.runId ?? null,
        input.localAccountId,
        input.profileId,
        input.campaignId ?? null,
        input.actionType,
        input.relationshipCycleId ?? null,
        input.planItemId ?? null,
        input.mediaId ?? null,
        input.idempotencyKey,
        now,
        now,
        now,
      );
    const attempt = this.findById(id);
    if (!attempt) {
      throw new Error('Falha ao preparar ação.');
    }
    return { created: true, attempt };
  }

  /**
   * Transiciona a ação validando a máquina de estados do domínio.
   */
  transition(id: string, to: ActionState, patch: CompleteActionInput = {}): ActionAttempt {
    const current = this.findById(id);
    if (!current) {
      throw new Error(`Ação não encontrada: ${id}`);
    }
    assertActionTransition(current.state, to);
    const now = nowIso();
    const isTerminal = to !== 'PENDING';
    this.db
      .prepare(
        `UPDATE action_attempts
            SET prev_state = state, state = ?, next_state = ?,
                result = COALESCE(?, result),
                error_category = COALESCE(?, error_category),
                error_normalized = COALESCE(?, error_normalized),
                screenshot_path = COALESCE(?, screenshot_path),
                trace_path = COALESCE(?, trace_path),
                ended_at = CASE WHEN ? = 1 THEN ? ELSE ended_at END,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        to,
        to,
        patch.result ?? null,
        patch.errorCategory ?? null,
        patch.errorNormalized ?? null,
        patch.screenshotPath ?? null,
        patch.tracePath ?? null,
        isTerminal ? 1 : 0,
        now,
        now,
        id,
      );
    const updated = this.findById(id);
    if (!updated) {
      throw new Error('Falha ao transicionar ação.');
    }
    return updated;
  }

  listByProfileId(profileId: string): ActionAttempt[] {
    const rows = this.db
      .prepare('SELECT * FROM action_attempts WHERE profile_id = ? ORDER BY created_at')
      .all(profileId) as ActionRow[];
    return rows.map(mapRow);
  }

  /** Verifica se já existe uma ação CONFIRMED do tipo para o perfil/campanha. */
  hasConfirmedAction(profileId: string, actionType: ActionType, campaignId?: string): boolean {
    const row = campaignId
      ? this.db
          .prepare(
            "SELECT 1 FROM action_attempts WHERE profile_id = ? AND action_type = ? AND state = 'CONFIRMED' AND campaign_id = ? LIMIT 1",
          )
          .get(profileId, actionType, campaignId)
      : this.db
          .prepare(
            "SELECT 1 FROM action_attempts WHERE profile_id = ? AND action_type = ? AND state = 'CONFIRMED' LIMIT 1",
          )
          .get(profileId, actionType);
    return row !== undefined;
  }

  listByRunId(runId: string): ActionAttempt[] {
    const rows = this.db
      .prepare('SELECT * FROM action_attempts WHERE run_id = ? ORDER BY created_at')
      .all(runId) as ActionRow[];
    return rows.map(mapRow);
  }

  /**
   * Conta ações reais de uma conta/tipo desde `sinceIso` (inclusive). Conta
   * estados que podem ter alcançado a plataforma (`CONFIRMED` e `AMBIGUOUS`),
   * para que o teto operacional diário seja conservador.
   */
  countRealActionsSince(localAccountId: string, actionType: ActionType, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM action_attempts
          WHERE local_account_id = ? AND action_type = ?
            AND state IN ('CONFIRMED', 'AMBIGUOUS')
            AND created_at >= ?`,
      )
      .get(localAccountId, actionType, sinceIso) as { n: number };
    return row.n;
  }
}

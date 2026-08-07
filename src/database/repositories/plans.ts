import type { SqliteDatabase } from '../connection.js';
import type { PlanState } from '../../domain/states.js';
import { hashObject, stableStringify } from '../../domain/hash.js';
import { newId, nowIso } from '../util.js';

export type PlanType = 'FOLLOW' | 'UNFOLLOW';

export interface Plan {
  readonly id: string;
  readonly type: PlanType;
  readonly state: PlanState;
  readonly criteriaJson: string;
  readonly criteriaHash: string;
  readonly configHash: string;
  readonly createdAt: string;
  readonly frozenAt: string | null;
  readonly invalidatedAt: string | null;
  readonly completedAt: string | null;
}

export interface PlanItem {
  readonly id: string;
  readonly planId: string;
  readonly profileId: string;
  readonly relationshipCycleId: string | null;
  readonly campaignId: string | null;
  readonly eligibilityReason: string | null;
  readonly snapshotJson: string | null;
  readonly position: number;
}

export interface PlanProgress {
  readonly total: number;
  readonly pending: number;
  readonly confirmed: number;
  readonly skipped: number;
  readonly ambiguous: number;
  readonly failed: number;
  readonly percentDone: number;
}

interface PlanRow {
  readonly id: string;
  readonly type: string;
  readonly state: string;
  readonly criteria_json: string;
  readonly criteria_hash: string;
  readonly config_hash: string;
  readonly created_at: string;
  readonly frozen_at: string | null;
  readonly invalidated_at: string | null;
  readonly completed_at: string | null;
}

interface PlanItemRow {
  readonly id: string;
  readonly plan_id: string;
  readonly profile_id: string;
  readonly relationship_cycle_id: string | null;
  readonly campaign_id: string | null;
  readonly eligibility_reason: string | null;
  readonly snapshot_json: string | null;
  readonly position: number;
}

function mapPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    type: row.type as PlanType,
    state: row.state as PlanState,
    criteriaJson: row.criteria_json,
    criteriaHash: row.criteria_hash,
    configHash: row.config_hash,
    createdAt: row.created_at,
    frozenAt: row.frozen_at,
    invalidatedAt: row.invalidated_at,
    completedAt: row.completed_at,
  };
}

function mapItem(row: PlanItemRow): PlanItem {
  return {
    id: row.id,
    planId: row.plan_id,
    profileId: row.profile_id,
    relationshipCycleId: row.relationship_cycle_id,
    campaignId: row.campaign_id,
    eligibilityReason: row.eligibility_reason,
    snapshotJson: row.snapshot_json,
    position: row.position,
  };
}

export class InvalidPlanStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPlanStateError';
  }
}

export class PlanRepo {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: { type: PlanType; criteria: unknown; config: unknown }): Plan {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO plans (id, type, state, criteria_json, criteria_hash, config_hash, created_at)
         VALUES (?, ?, 'DRAFT', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.type,
        stableStringify(input.criteria),
        hashObject(input.criteria),
        hashObject(input.config),
        nowIso(),
      );
    return this.getOrThrow(id);
  }

  get(id: string): Plan | undefined {
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined;
    return row ? mapPlan(row) : undefined;
  }

  getOrThrow(id: string): Plan {
    const plan = this.get(id);
    if (!plan) {
      throw new InvalidPlanStateError(`Plano não encontrado: ${id}`);
    }
    return plan;
  }

  list(): Plan[] {
    const rows = this.db.prepare('SELECT * FROM plans ORDER BY created_at').all() as PlanRow[];
    return rows.map(mapPlan);
  }

  /** Adiciona um item ao plano. Só é permitido enquanto o plano é `DRAFT`. */
  addItem(input: {
    planId: string;
    profileId: string;
    position: number;
    campaignId?: string;
    relationshipCycleId?: string;
    eligibilityReason?: string;
    snapshot?: unknown;
  }): PlanItem {
    const plan = this.getOrThrow(input.planId);
    if (plan.state !== 'DRAFT') {
      throw new InvalidPlanStateError(`Plano ${plan.id} não é DRAFT; não aceita novos itens.`);
    }
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO plan_items
           (id, plan_id, profile_id, relationship_cycle_id, campaign_id, eligibility_reason, snapshot_json, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.planId,
        input.profileId,
        input.relationshipCycleId ?? null,
        input.campaignId ?? null,
        input.eligibilityReason ?? null,
        input.snapshot === undefined ? null : stableStringify(input.snapshot),
        input.position,
        nowIso(),
      );
    const row = this.db.prepare('SELECT * FROM plan_items WHERE id = ?').get(id) as
      PlanItemRow | undefined;
    if (!row) {
      throw new InvalidPlanStateError('Falha ao adicionar item ao plano.');
    }
    return mapItem(row);
  }

  listItems(planId: string): PlanItem[] {
    const rows = this.db
      .prepare('SELECT * FROM plan_items WHERE plan_id = ? ORDER BY position')
      .all(planId) as PlanItemRow[];
    return rows.map(mapItem);
  }

  /**
   * Resumo de progresso do plano: quantos itens já foram confirmados, pulados,
   * ambíguos, falharam ou continuam pendentes. Itens sem tentativa (ou em
   * PREPARED/PENDING) contam como pendentes.
   */
  progress(planId: string): PlanProgress {
    const rows = this.db
      .prepare(
        `SELECT CASE
                  WHEN a.state = 'AMBIGUOUS' AND ar.resolution = 'SKIP_NO_RETRY' THEN 'SKIPPED'
                  ELSE COALESCE(a.state, 'PENDING')
                END AS state,
                COUNT(*) AS n
           FROM plan_items pi
           LEFT JOIN action_attempts a ON a.plan_item_id = pi.id
           LEFT JOIN action_reconciliations ar ON ar.action_attempt_id = a.id
          WHERE pi.plan_id = ?
          GROUP BY CASE
                     WHEN a.state = 'AMBIGUOUS' AND ar.resolution = 'SKIP_NO_RETRY' THEN 'SKIPPED'
                     ELSE COALESCE(a.state, 'PENDING')
                   END`,
      )
      .all(planId) as { state: string; n: number }[];

    let total = 0;
    let confirmed = 0;
    let skipped = 0;
    let ambiguous = 0;
    let failed = 0;
    for (const row of rows) {
      total += row.n;
      switch (row.state) {
        case 'CONFIRMED':
          confirmed += row.n;
          break;
        case 'SKIPPED':
          skipped += row.n;
          break;
        case 'AMBIGUOUS':
          ambiguous += row.n;
          break;
        case 'FAILED':
          failed += row.n;
          break;
        default:
          break;
      }
    }
    const pending = total - confirmed - skipped - ambiguous - failed;
    const percentDone = total === 0 ? 0 : Math.round(((total - pending) / total) * 100);
    return { total, pending, confirmed, skipped, ambiguous, failed, percentDone };
  }

  /** Congela o plano, tornando-o imutável. Só de `DRAFT` para `FROZEN`. */
  freeze(planId: string): Plan {
    const plan = this.getOrThrow(planId);
    if (plan.state !== 'DRAFT') {
      throw new InvalidPlanStateError(
        `Só é possível congelar um plano DRAFT (atual: ${plan.state}).`,
      );
    }
    this.db
      .prepare("UPDATE plans SET state = 'FROZEN', frozen_at = ? WHERE id = ?")
      .run(nowIso(), planId);
    return this.getOrThrow(planId);
  }

  invalidate(planId: string): Plan {
    const plan = this.getOrThrow(planId);
    if (plan.state === 'COMPLETED') {
      throw new InvalidPlanStateError('Plano concluído não pode ser invalidado.');
    }
    this.db
      .prepare("UPDATE plans SET state = 'INVALIDATED', invalidated_at = ? WHERE id = ?")
      .run(nowIso(), planId);
    return this.getOrThrow(planId);
  }

  complete(planId: string): Plan {
    const plan = this.getOrThrow(planId);
    if (plan.state !== 'FROZEN') {
      throw new InvalidPlanStateError(
        `Só um plano FROZEN pode ser concluído (atual: ${plan.state}).`,
      );
    }
    this.db
      .prepare("UPDATE plans SET state = 'COMPLETED', completed_at = ? WHERE id = ?")
      .run(nowIso(), planId);
    return this.getOrThrow(planId);
  }
}

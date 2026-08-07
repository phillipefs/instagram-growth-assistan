import type { SqliteDatabase } from '../connection.js';
import type { RunState } from '../../domain/states.js';
import type { ExecutionMode } from '../../config/schema.js';
import { newId, nowIso } from '../util.js';

export type RunType = 'COLLECT' | 'FOLLOW' | 'LIKE_POST' | 'UNFOLLOW';

export interface Run {
  readonly id: string;
  readonly type: RunType;
  readonly mode: ExecutionMode;
  readonly localAccountId: string | null;
  readonly planId: string | null;
  readonly configJson: string | null;
  readonly status: RunState;
  readonly countersJson: string | null;
  readonly stopReason: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly createdAt: string;
}

interface RunRow {
  readonly id: string;
  readonly type: string;
  readonly mode: string;
  readonly local_account_id: string | null;
  readonly plan_id: string | null;
  readonly config_json: string | null;
  readonly status: string;
  readonly counters_json: string | null;
  readonly stop_reason: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly created_at: string;
}

function mapRow(row: RunRow): Run {
  return {
    id: row.id,
    type: row.type as RunType,
    mode: row.mode as ExecutionMode,
    localAccountId: row.local_account_id,
    planId: row.plan_id,
    configJson: row.config_json,
    status: row.status as RunState,
    countersJson: row.counters_json,
    stopReason: row.stop_reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export class RunRepo {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    type: RunType;
    mode: ExecutionMode;
    localAccountId?: string;
    planId?: string;
    config?: unknown;
  }): Run {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO runs (id, type, mode, local_account_id, plan_id, config_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'CREATED', ?)`,
      )
      .run(
        id,
        input.type,
        input.mode,
        input.localAccountId ?? null,
        input.planId ?? null,
        input.config === undefined ? null : JSON.stringify(input.config),
        nowIso(),
      );
    return this.getOrThrow(id);
  }

  get(id: string): Run | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getOrThrow(id: string): Run {
    const run = this.get(id);
    if (!run) {
      throw new Error(`Run não encontrada: ${id}`);
    }
    return run;
  }

  list(): Run[] {
    const rows = this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all() as RunRow[];
    return rows.map(mapRow);
  }

  start(id: string): Run {
    this.db
      .prepare("UPDATE runs SET status = 'RUNNING', started_at = COALESCE(started_at, ?) WHERE id = ?")
      .run(nowIso(), id);
    return this.getOrThrow(id);
  }

  updateCounters(id: string, counters: unknown): Run {
    this.db.prepare('UPDATE runs SET counters_json = ? WHERE id = ?').run(JSON.stringify(counters), id);
    return this.getOrThrow(id);
  }

  finish(id: string, status: RunState, stopReason?: string): Run {
    this.db
      .prepare('UPDATE runs SET status = ?, stop_reason = ?, ended_at = ? WHERE id = ?')
      .run(status, stopReason ?? null, nowIso(), id);
    return this.getOrThrow(id);
  }
}

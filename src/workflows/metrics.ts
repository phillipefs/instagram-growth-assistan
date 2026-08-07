import type { SqliteDatabase } from '../database/connection.js';

export interface CampaignMetric {
  readonly name: string;
  readonly candidates: number;
  readonly bySource: Record<string, number>;
}

export interface ActionMetric {
  readonly actionType: string;
  readonly confirmed: number;
  readonly ambiguous: number;
  readonly failed: number;
  readonly skipped: number;
  readonly pending: number;
}

export interface CycleMetric {
  readonly origin: string;
  readonly open: number;
  readonly closed: number;
}

export interface CampaignFollowMetric {
  readonly name: string;
  readonly following: number;
  readonly requested: number;
  readonly total: number;
}

export interface Metrics {
  readonly campaigns: CampaignMetric[];
  readonly runsByType: Record<string, number>;
  readonly actions: ActionMetric[];
  readonly cyclesByOrigin: CycleMetric[];
  readonly openFollowsByState: Record<string, number>;
  readonly followsByCampaign: CampaignFollowMetric[];
  readonly followBack: Record<string, number>;
}

/**
 * Agrega métricas somente leitura para o experimento de validação: cobertura de
 * coleta por campanha/fonte, execuções por tipo, desfecho das ações, ciclos
 * abertos/fechados por origem e distribuição de follow-back.
 */
export function computeMetrics(db: SqliteDatabase): Metrics {
  const campaignRows = db
    .prepare(
      `SELECT c.name AS name, cc.discovery_source AS source, COUNT(*) AS n
         FROM campaign_candidates cc
         JOIN campaigns c ON c.id = cc.campaign_id
        GROUP BY c.name, cc.discovery_source
        ORDER BY c.name`,
    )
    .all() as { name: string; source: string; n: number }[];
  const campaignMap = new Map<string, { candidates: number; bySource: Record<string, number> }>();
  for (const row of campaignRows) {
    const entry = campaignMap.get(row.name) ?? { candidates: 0, bySource: {} };
    entry.candidates += row.n;
    entry.bySource[row.source] = (entry.bySource[row.source] ?? 0) + row.n;
    campaignMap.set(row.name, entry);
  }
  const campaigns: CampaignMetric[] = [...campaignMap.entries()].map(([name, e]) => ({
    name,
    candidates: e.candidates,
    bySource: e.bySource,
  }));

  const runRows = db.prepare('SELECT type, COUNT(*) AS n FROM runs GROUP BY type').all() as {
    type: string;
    n: number;
  }[];
  const runsByType: Record<string, number> = {};
  for (const row of runRows) {
    runsByType[row.type] = row.n;
  }

  const actionRows = db
    .prepare('SELECT action_type AS type, state, COUNT(*) AS n FROM action_attempts GROUP BY action_type, state')
    .all() as { type: string; state: string; n: number }[];
  const actionMap = new Map<string, ActionMetric>();
  for (const row of actionRows) {
    const current = actionMap.get(row.type) ?? {
      actionType: row.type,
      confirmed: 0,
      ambiguous: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
    };
    const next: ActionMetric = {
      ...current,
      confirmed: current.confirmed + (row.state === 'CONFIRMED' ? row.n : 0),
      ambiguous: current.ambiguous + (row.state === 'AMBIGUOUS' ? row.n : 0),
      failed: current.failed + (row.state === 'FAILED' ? row.n : 0),
      skipped: current.skipped + (row.state === 'SKIPPED' ? row.n : 0),
      pending: current.pending + (row.state === 'PREPARED' || row.state === 'PENDING' ? row.n : 0),
    };
    actionMap.set(row.type, next);
  }
  const actions = [...actionMap.values()];

  const cycleRows = db
    .prepare(
      `SELECT origin,
              CASE WHEN unfollowed_at IS NULL THEN 'open' ELSE 'closed' END AS status,
              COUNT(*) AS n
         FROM relationship_cycles
        GROUP BY origin, status`,
    )
    .all() as { origin: string; status: string; n: number }[];
  const cycleMap = new Map<string, { open: number; closed: number }>();
  for (const row of cycleRows) {
    const entry = cycleMap.get(row.origin) ?? { open: 0, closed: 0 };
    if (row.status === 'open') {
      entry.open += row.n;
    } else {
      entry.closed += row.n;
    }
    cycleMap.set(row.origin, entry);
  }
  const cyclesByOrigin: CycleMetric[] = [...cycleMap.entries()].map(([origin, e]) => ({
    origin,
    open: e.open,
    closed: e.closed,
  }));

  const followBackRows = db
    .prepare('SELECT follow_back AS fb, COUNT(*) AS n FROM relationship_cycles GROUP BY follow_back')
    .all() as { fb: string; n: number }[];
  const followBack: Record<string, number> = {};
  for (const row of followBackRows) {
    followBack[row.fb] = row.n;
  }

  // Ciclos abertos por estado: FOLLOWING = seguido de fato (perfil aberto);
  // FOLLOW_REQUESTED = solicitação enviada (perfil fechado).
  const openStateRows = db
    .prepare(
      "SELECT state, COUNT(*) AS n FROM relationship_cycles WHERE unfollowed_at IS NULL GROUP BY state",
    )
    .all() as { state: string; n: number }[];
  const openFollowsByState: Record<string, number> = {};
  for (const row of openStateRows) {
    openFollowsByState[row.state] = row.n;
  }

  // Follows abertos por campanha (FOLLOWING = aberto; FOLLOW_REQUESTED = solicitação).
  const campaignFollowRows = db
    .prepare(
      `SELECT COALESCE(c.name, '(sem campanha)') AS name, rc.state AS state, COUNT(*) AS n
         FROM relationship_cycles rc
         LEFT JOIN campaigns c ON c.id = rc.campaign_id
        WHERE rc.unfollowed_at IS NULL
        GROUP BY name, rc.state
        ORDER BY name`,
    )
    .all() as { name: string; state: string; n: number }[];
  const campaignFollowMap = new Map<string, { following: number; requested: number; total: number }>();
  for (const row of campaignFollowRows) {
    const entry = campaignFollowMap.get(row.name) ?? { following: 0, requested: 0, total: 0 };
    entry.total += row.n;
    if (row.state === 'FOLLOWING') {
      entry.following += row.n;
    } else if (row.state === 'FOLLOW_REQUESTED') {
      entry.requested += row.n;
    }
    campaignFollowMap.set(row.name, entry);
  }
  const followsByCampaign: CampaignFollowMetric[] = [...campaignFollowMap.entries()].map(([name, e]) => ({
    name,
    following: e.following,
    requested: e.requested,
    total: e.total,
  }));

  return { campaigns, runsByType, actions, cyclesByOrigin, openFollowsByState, followsByCampaign, followBack };
}

/** Renderiza as métricas do experimento como texto legível. */
export function formatMetrics(metrics: Metrics): string {
  const lines: string[] = [];
  lines.push('Métricas do experimento (somente leitura)');
  lines.push('');

  lines.push('Coleta por campanha:');
  if (metrics.campaigns.length === 0) {
    lines.push('  (nenhuma campanha com candidatos)');
  } else {
    for (const c of metrics.campaigns) {
      const sources = Object.entries(c.bySource)
        .map(([source, n]) => `${source}=${n}`)
        .join(', ');
      lines.push(`  ${c.name}: ${c.candidates} candidato(s) [${sources}]`);
    }
  }

  lines.push('');
  lines.push('Execuções por tipo:');
  const runTypes = Object.entries(metrics.runsByType);
  if (runTypes.length === 0) {
    lines.push('  (nenhuma execução)');
  } else {
    for (const [type, n] of runTypes) {
      lines.push(`  ${type}: ${n}`);
    }
  }

  lines.push('');
  lines.push('Desfecho das ações:');
  if (metrics.actions.length === 0) {
    lines.push('  (nenhuma ação registrada)');
  } else {
    for (const a of metrics.actions) {
      lines.push(
        `  ${a.actionType}: confirmadas=${a.confirmed} ambíguas=${a.ambiguous} falhas=${a.failed} puladas=${a.skipped} pendentes=${a.pending}`,
      );
    }
  }

  lines.push('');
  lines.push('Ciclos de relacionamento por origem:');
  if (metrics.cyclesByOrigin.length === 0) {
    lines.push('  (nenhum ciclo)');
  } else {
    for (const c of metrics.cyclesByOrigin) {
      lines.push(`  ${c.origin}: abertos=${c.open} fechados=${c.closed}`);
    }
  }

  lines.push('');
  lines.push('Follows abertos por estado:');
  const followingNow = metrics.openFollowsByState.FOLLOWING ?? 0;
  const requested = metrics.openFollowsByState.FOLLOW_REQUESTED ?? 0;
  const otherStates = Object.entries(metrics.openFollowsByState).filter(
    ([state]) => state !== 'FOLLOWING' && state !== 'FOLLOW_REQUESTED',
  );
  if (followingNow === 0 && requested === 0 && otherStates.length === 0) {
    lines.push('  (nenhum follow aberto)');
  } else {
    lines.push(`  seguidos de fato (perfil aberto):        ${followingNow}`);
    lines.push(`  solicitações enviadas (perfil fechado):  ${requested}`);
    for (const [state, n] of otherStates) {
      lines.push(`  ${state}: ${n}`);
    }
  }

  lines.push('');
  lines.push('Follows por campanha (abertos):');
  if (metrics.followsByCampaign.length === 0) {
    lines.push('  (nenhum follow aberto)');
  } else {
    for (const c of metrics.followsByCampaign) {
      lines.push(`  ${c.name}: ${c.following} seguindo, ${c.requested} solicitações  (${c.total})`);
    }
  }

  lines.push('');
  lines.push('Follow-back observado:');
  const fb = Object.entries(metrics.followBack);
  if (fb.length === 0) {
    lines.push('  (nenhuma observação)');
  } else {
    for (const [state, n] of fb) {
      lines.push(`  ${state}: ${n}`);
    }
  }

  return lines.join('\n');
}

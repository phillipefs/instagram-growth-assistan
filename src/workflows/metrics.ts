import type { SqliteDatabase } from '../database/connection.js';
import { FollowerSnapshotRepo } from '../database/repositories/follower-snapshots.js';

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
  readonly unfollowed: number;
  readonly open: number;
  /** Total histórico de ciclos, abertos e fechados. */
  readonly total: number;
}

export interface ConversionMetric {
  readonly name: string;
  /** Pessoas distintas com follow confirmado pela ferramenta. */
  readonly followed: number;
  /** Pessoas seguidas pela ferramenta que aparecem como seguidoras. */
  readonly followedBack: number;
  readonly ratePct: number | null;
  /** Pessoas cuja condição de seguidor foi verificada pela fonte usada. */
  readonly inspected: number;
  readonly coveragePct: number | null;
}

export interface ConversionMetrics {
  readonly account: string;
  readonly source: 'FOLLOWER_SNAPSHOT' | 'FOLLOWER_SNAPSHOT_TOLERATED' | 'FOLLOW_BACK_OBSERVATION';
  readonly observedAt: string | null;
  readonly campaigns: ConversionMetric[];
  /** Consolidado de pessoas únicas, sem somar duplicatas entre campanhas. */
  readonly total: Omit<ConversionMetric, 'name'>;
}

export interface Metrics {
  readonly campaigns: CampaignMetric[];
  readonly runsByType: Record<string, number>;
  readonly actions: ActionMetric[];
  readonly cyclesByOrigin: CycleMetric[];
  readonly openFollowsByState: Record<string, number>;
  readonly followsByCampaign: CampaignFollowMetric[];
  readonly followBack: Record<string, number>;
  readonly followBackSnapshot: {
    readonly status: 'COMPLETE' | 'TOLERATED';
    readonly observedAt: string;
    readonly expectedCount: number | null;
    readonly loadedCount: number;
    readonly coveragePct: number | null;
  } | null;
  readonly conversion: ConversionMetrics | null;
}

/**
 * Agrega métricas somente leitura para o experimento de validação: cobertura de
 * coleta por campanha/fonte, execuções por tipo, desfecho das ações, ciclos
 * abertos/fechados por origem e distribuição de follow-back.
 */
export function computeMetrics(db: SqliteDatabase, localAccountId?: string): Metrics {
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
    .prepare(
      'SELECT action_type AS type, state, COUNT(*) AS n FROM action_attempts GROUP BY action_type, state',
    )
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

  const acceptedSnapshot = localAccountId
    ? new FollowerSnapshotRepo(db).latestAccepted(localAccountId)
    : undefined;
  const followBackRows = acceptedSnapshot
    ? (db
        .prepare(
          `SELECT CASE
                    WHEN julianday(COALESCE(rc.followed_at, rc.created_at)) > julianday(@observed)
                      THEN 'UNKNOWN'
                    WHEN EXISTS (
                      SELECT 1 FROM follower_snapshot_members member
                       WHERE member.snapshot_id = @snapshot
                         AND member.profile_id = r.profile_id
                    ) THEN 'YES'
                    ELSE 'NO'
                  END AS fb,
                  COUNT(*) AS n
             FROM relationship_cycles rc
             JOIN relationships r ON r.id = rc.relationship_id
            WHERE r.local_account_id = @account
            GROUP BY fb`,
        )
        .all({
          snapshot: acceptedSnapshot.id,
          account: localAccountId,
          observed: acceptedSnapshot.observedAt,
        }) as { fb: string; n: number }[])
    : (db
        .prepare(
          'SELECT follow_back AS fb, COUNT(*) AS n FROM relationship_cycles GROUP BY follow_back',
        )
        .all() as { fb: string; n: number }[]);
  const followBack: Record<string, number> = {};
  for (const row of followBackRows) {
    followBack[row.fb] = row.n;
  }

  // Ciclos abertos por estado: FOLLOWING = seguido de fato (perfil aberto);
  // FOLLOW_REQUESTED = solicitação enviada (perfil fechado).
  const openStateRows = db
    .prepare(
      'SELECT state, COUNT(*) AS n FROM relationship_cycles WHERE unfollowed_at IS NULL GROUP BY state',
    )
    .all() as { state: string; n: number }[];
  const openFollowsByState: Record<string, number> = {};
  for (const row of openStateRows) {
    openFollowsByState[row.state] = row.n;
  }

  // Histórico por campanha. Ciclos fechados continuam aparecendo após o unfollow.
  const campaignFollowRows = db
    .prepare(
      `SELECT COALESCE(c.name, '(sem campanha)') AS name, rc.state AS state,
              CASE WHEN rc.unfollowed_at IS NULL THEN 0 ELSE 1 END AS closed,
              COUNT(*) AS n
         FROM relationship_cycles rc
         LEFT JOIN campaigns c ON c.id = rc.campaign_id
        GROUP BY name, rc.state, closed
        ORDER BY name`,
    )
    .all() as { name: string; state: string; closed: number; n: number }[];
  const campaignFollowMap = new Map<
    string,
    { following: number; requested: number; unfollowed: number; open: number; total: number }
  >();
  for (const row of campaignFollowRows) {
    const entry = campaignFollowMap.get(row.name) ?? {
      following: 0,
      requested: 0,
      unfollowed: 0,
      open: 0,
      total: 0,
    };
    entry.total += row.n;
    if (row.closed === 1) {
      entry.unfollowed += row.n;
    } else {
      entry.open += row.n;
      if (row.state === 'FOLLOWING') {
        entry.following += row.n;
      } else if (row.state === 'FOLLOW_REQUESTED') {
        entry.requested += row.n;
      }
    }
    campaignFollowMap.set(row.name, entry);
  }
  const followsByCampaign: CampaignFollowMetric[] = [...campaignFollowMap.entries()].map(
    ([name, e]) => ({
      name,
      following: e.following,
      requested: e.requested,
      unfollowed: e.unfollowed,
      open: e.open,
      total: e.total,
    }),
  );

  const conversion = localAccountId ? computeConversionMetrics(db, localAccountId) : null;
  const followBackSnapshot = acceptedSnapshot
    ? {
        status: acceptedSnapshot.status as 'COMPLETE' | 'TOLERATED',
        observedAt: acceptedSnapshot.observedAt,
        expectedCount: acceptedSnapshot.expectedCount,
        loadedCount: acceptedSnapshot.loadedCount,
        coveragePct:
          acceptedSnapshot.expectedCount === null || acceptedSnapshot.expectedCount === 0
            ? null
            : percentage(acceptedSnapshot.loadedCount, acceptedSnapshot.expectedCount),
      }
    : null;

  return {
    campaigns,
    runsByType,
    actions,
    cyclesByOrigin,
    openFollowsByState,
    followsByCampaign,
    followBack,
    followBackSnapshot,
    conversion,
  };
}

interface ConversionCycleRow {
  readonly campaign_id: string;
  readonly profile_id: string;
  readonly followed_at: string | null;
  readonly follow_back: string;
  readonly follow_back_checked_at: string | null;
}

function computeConversionMetrics(
  db: SqliteDatabase,
  localAccountId: string,
): ConversionMetrics | null {
  const account = db
    .prepare('SELECT username FROM local_accounts WHERE id = ?')
    .get(localAccountId) as { username: string } | undefined;
  if (!account) return null;

  const campaignRows = db.prepare('SELECT id, name FROM campaigns ORDER BY name').all() as {
    id: string;
    name: string;
  }[];
  const cycleRows = db
    .prepare(
      `SELECT rc.campaign_id, r.profile_id, rc.followed_at, rc.follow_back,
              rc.follow_back_checked_at
         FROM relationship_cycles rc
         JOIN relationships r ON r.id = rc.relationship_id
        WHERE r.local_account_id = ?
          AND rc.campaign_id IS NOT NULL
          AND rc.origin = 'TOOL_CLICK'
          AND rc.followed_by_tool = 1
        ORDER BY rc.created_at, rc.id`,
    )
    .all(localAccountId) as ConversionCycleRow[];

  const profilesByCampaign = new Map<string, Set<string>>();
  const observationByCampaign = new Map<string, Map<string, ConversionCycleRow>>();
  const firstFollowByCampaign = new Map<string, Map<string, string | null>>();
  const allProfiles = new Set<string>();
  const latestObservationByProfile = new Map<string, ConversionCycleRow>();
  const firstFollowByProfile = new Map<string, string | null>();
  for (const row of cycleRows) {
    const profiles = profilesByCampaign.get(row.campaign_id) ?? new Set<string>();
    profiles.add(row.profile_id);
    profilesByCampaign.set(row.campaign_id, profiles);

    const observations = observationByCampaign.get(row.campaign_id) ?? new Map();
    observations.set(row.profile_id, row);
    observationByCampaign.set(row.campaign_id, observations);

    const campaignFollows = firstFollowByCampaign.get(row.campaign_id) ?? new Map();
    if (!campaignFollows.has(row.profile_id)) {
      campaignFollows.set(row.profile_id, row.followed_at);
    }
    firstFollowByCampaign.set(row.campaign_id, campaignFollows);

    allProfiles.add(row.profile_id);
    latestObservationByProfile.set(row.profile_id, row);
    if (!firstFollowByProfile.has(row.profile_id)) {
      firstFollowByProfile.set(row.profile_id, row.followed_at);
    }
  }

  const snapshots = new FollowerSnapshotRepo(db);
  const latestSnapshot = snapshots.latestAccepted(localAccountId);
  const snapshotMembers = latestSnapshot
    ? snapshots.memberProfileIds(latestSnapshot.id)
    : undefined;

  const summarize = (
    profiles: ReadonlySet<string>,
    observations: ReadonlyMap<string, ConversionCycleRow>,
    firstFollows: ReadonlyMap<string, string | null>,
  ): Omit<ConversionMetric, 'name'> => {
    let followedBack = 0;
    let inspected = 0;
    for (const profileId of profiles) {
      if (snapshotMembers) {
        const followedAt = firstFollows.get(profileId);
        if (
          followedAt &&
          latestSnapshot &&
          Date.parse(latestSnapshot.observedAt) >= Date.parse(followedAt)
        ) {
          inspected += 1;
          if (snapshotMembers.has(profileId)) followedBack += 1;
        }
        continue;
      }
      const observation = observations.get(profileId);
      if (observation?.follow_back_checked_at) {
        inspected += 1;
        if (observation.follow_back === 'YES') followedBack += 1;
      }
    }
    return {
      followed: profiles.size,
      followedBack,
      ratePct:
        profiles.size === 0 || inspected === 0 ? null : percentage(followedBack, profiles.size),
      inspected,
      coveragePct: percentage(inspected, profiles.size),
    };
  };

  return {
    account: account.username,
    source: snapshotMembers
      ? latestSnapshot?.status === 'TOLERATED'
        ? 'FOLLOWER_SNAPSHOT_TOLERATED'
        : 'FOLLOWER_SNAPSHOT'
      : 'FOLLOW_BACK_OBSERVATION',
    observedAt: latestSnapshot?.observedAt ?? null,
    campaigns: campaignRows.map((campaign) => ({
      name: campaign.name,
      ...summarize(
        profilesByCampaign.get(campaign.id) ?? new Set<string>(),
        observationByCampaign.get(campaign.id) ?? new Map<string, ConversionCycleRow>(),
        firstFollowByCampaign.get(campaign.id) ?? new Map<string, string | null>(),
      ),
    })),
    total: summarize(allProfiles, latestObservationByProfile, firstFollowByProfile),
  };
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
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
  lines.push('Follows por campanha (histórico):');
  if (metrics.followsByCampaign.length === 0) {
    lines.push('  (nenhum follow registrado)');
  } else {
    for (const c of metrics.followsByCampaign) {
      lines.push(
        `  ${c.name}: ${c.following} seguindo, ${c.requested} solicitações, ${c.unfollowed} unfollow (${c.total} histórico)`,
      );
    }
  }

  lines.push('');
  lines.push('Conversão de follow por campanha:');
  if (!metrics.conversion) {
    lines.push('  (nenhuma conta local para calcular a conversão)');
  } else {
    lines.push(`  Conta: ${metrics.conversion.account}`);
    for (const campaign of metrics.conversion.campaigns) {
      lines.push(formatConversionLine(campaign.name, campaign));
    }
    lines.push(formatConversionLine('TOTAL (pessoas únicas)', metrics.conversion.total));
    if (metrics.conversion.source === 'FOLLOWER_SNAPSHOT') {
      lines.push(`  Fonte: snapshot completo de seguidores em ${metrics.conversion.observedAt}`);
    } else if (metrics.conversion.source === 'FOLLOWER_SNAPSHOT_TOLERATED') {
      lines.push(
        `  Fonte: snapshot tolerado de seguidores em ${metrics.conversion.observedAt} (margem de até 1% aceita para métricas)`,
      );
    } else {
      lines.push(
        '  Fonte: observações locais de follow-back (pode haver perfis não inspecionados)',
      );
    }
  }

  lines.push('');
  lines.push('Follow-back observado:');
  if (metrics.followBackSnapshot) {
    const snapshot = metrics.followBackSnapshot;
    const coverage =
      snapshot.coveragePct === null ? 'indisponível' : `${snapshot.coveragePct.toFixed(2)}%`;
    lines.push(
      `  Fonte: snapshot ${snapshot.status} em ${snapshot.observedAt} (${snapshot.loadedCount}/${snapshot.expectedCount ?? '?'}, cobertura da lista=${coverage})`,
    );
  }
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

function formatConversionLine(label: string, metric: Omit<ConversionMetric, 'name'>): string {
  const rate = metric.ratePct === null ? 'indisponível' : `${metric.ratePct.toFixed(2)}%`;
  const coverage =
    metric.coveragePct === null ? 'sem follows' : `${metric.coveragePct.toFixed(2)}%`;
  return `  ${label}: seguidos=${metric.followed} seguiram_de_volta=${metric.followedBack} conversão=${rate} cobertura=${coverage}`;
}

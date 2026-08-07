import type { SqliteDatabase } from '../database/connection.js';
import type { FollowBackState } from '../domain/states.js';
import { isEligibleForUnfollowByFollowBack } from '../domain/follow-back.js';
import { computeUnfollowWindow, type CohortWindow, type UnfollowFilters } from '../domain/cohort.js';
import { PlanRepo, type Plan } from '../database/repositories/plans.js';

export interface UnfollowCandidate {
  readonly cycleId: string;
  readonly relationshipId: string;
  readonly profileId: string;
  readonly username: string;
  readonly followedAt: string;
  readonly campaignId: string | null;
  readonly followedByTool: boolean;
  readonly followBack: FollowBackState;
  readonly followBackCheckedAt: string | null;
  readonly whitelisted: boolean;
  readonly protected: boolean;
}

interface CohortRow {
  readonly cycle_id: string;
  readonly relationship_id: string;
  readonly profile_id: string;
  readonly username: string;
  readonly followed_at: string;
  readonly campaign_id: string | null;
  readonly followed_by_tool: number;
  readonly follow_back: string;
  readonly follow_back_checked_at: string | null;
  readonly whitelisted: number;
  readonly protected: number;
}

/**
 * Carrega os ciclos abertos (com follow registrado) na janela e campanha, sem
 * ainda aplicar whitelist/proteção/histórico — isso é classificado na prévia.
 */
export function loadUnfollowCohort(
  db: SqliteDatabase,
  input: { localAccountId: string; window: CohortWindow; campaignId?: string },
): UnfollowCandidate[] {
  const clauses: string[] = [
    'r.local_account_id = @account',
    'rc.unfollowed_at IS NULL',
    'rc.followed_at IS NOT NULL',
  ];
  const params: Record<string, string> = { account: input.localAccountId };
  if (input.window.fromIso) {
    clauses.push('rc.followed_at >= @from');
    params.from = input.window.fromIso;
  }
  if (input.window.toIso) {
    clauses.push('rc.followed_at <= @to');
    params.to = input.window.toIso;
  }
  if (input.campaignId) {
    clauses.push('rc.campaign_id = @campaign');
    params.campaign = input.campaignId;
  }

  const rows = db
    .prepare(
      `SELECT rc.id AS cycle_id, r.id AS relationship_id, r.profile_id AS profile_id,
              p.username_display AS username, rc.followed_at AS followed_at, rc.campaign_id AS campaign_id,
              rc.followed_by_tool AS followed_by_tool, rc.follow_back AS follow_back,
              rc.follow_back_checked_at AS follow_back_checked_at,
              r.whitelisted AS whitelisted, r.protected AS protected
         FROM relationship_cycles rc
         JOIN relationships r ON r.id = rc.relationship_id
         JOIN profiles p ON p.id = r.profile_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY rc.followed_at, rc.id`,
    )
    .all(params) as CohortRow[];

  return rows.map((row) => ({
    cycleId: row.cycle_id,
    relationshipId: row.relationship_id,
    profileId: row.profile_id,
    username: row.username,
    followedAt: row.followed_at,
    campaignId: row.campaign_id,
    followedByTool: row.followed_by_tool === 1,
    followBack: row.follow_back as FollowBackState,
    followBackCheckedAt: row.follow_back_checked_at,
    whitelisted: row.whitelisted === 1,
    protected: row.protected === 1,
  }));
}

export type UnfollowExclusion =
  | 'no_tool_history'
  | 'whitelisted'
  | 'protected'
  | 'follower'
  | 'follow_back_not_no';

export interface UnfollowPreviewOptions {
  readonly preserveFollowBacks: boolean;
  readonly followBackValidityDays: number;
  readonly excludeFollowers?: boolean;
  readonly limit?: number;
  readonly now?: Date;
}

export interface UnfollowPreview {
  readonly totalFound: number;
  readonly totalEligible: number;
  readonly totalProposed: number;
  readonly excluded: Record<UnfollowExclusion, number>;
  readonly proposed: {
    readonly username: string;
    readonly followedAt: string;
    readonly campaignId: string | null;
  }[];
}

/** Seleciona os candidatos elegíveis, ordenados do follow mais antigo ao mais recente. */
export function selectEligibleUnfollowCandidates(
  candidates: readonly UnfollowCandidate[],
  options: UnfollowPreviewOptions,
): UnfollowCandidate[] {
  const now = options.now ?? new Date();
  const eligible = candidates.filter((c) => {
    if (!c.followedByTool || c.whitelisted || c.protected) {
      return false;
    }
    if (options.excludeFollowers && c.followBack === 'YES') {
      return false;
    }
    return isEligibleForUnfollowByFollowBack({
      value: c.followBack,
      checkedAt: c.followBackCheckedAt,
      validityDays: options.followBackValidityDays,
      preserveFollowBacks: options.preserveFollowBacks,
      now,
    });
  });
  eligible.sort((a, b) => (a.followedAt < b.followedAt ? -1 : a.followedAt > b.followedAt ? 1 : 0));
  return options.limit && options.limit > 0 ? eligible.slice(0, options.limit) : eligible;
}

/** Prévia (dry-run) do unfollow com contagem de exclusões. Nenhuma ação real. */
export function buildUnfollowPreview(
  candidates: readonly UnfollowCandidate[],
  options: UnfollowPreviewOptions,
): UnfollowPreview {
  const now = options.now ?? new Date();
  const excluded: Record<UnfollowExclusion, number> = {
    no_tool_history: 0,
    whitelisted: 0,
    protected: 0,
    follower: 0,
    follow_back_not_no: 0,
  };

  let eligibleCount = 0;
  for (const c of candidates) {
    if (!c.followedByTool) {
      excluded.no_tool_history += 1;
    } else if (c.whitelisted) {
      excluded.whitelisted += 1;
    } else if (c.protected) {
      excluded.protected += 1;
    } else if (options.excludeFollowers && c.followBack === 'YES') {
      excluded.follower += 1;
    } else if (
      !isEligibleForUnfollowByFollowBack({
        value: c.followBack,
        checkedAt: c.followBackCheckedAt,
        validityDays: options.followBackValidityDays,
        preserveFollowBacks: options.preserveFollowBacks,
        now,
      })
    ) {
      excluded.follow_back_not_no += 1;
    } else {
      eligibleCount += 1;
    }
  }

  const proposed = selectEligibleUnfollowCandidates(candidates, options);
  return {
    totalFound: candidates.length,
    totalEligible: eligibleCount,
    totalProposed: proposed.length,
    excluded,
    proposed: proposed.map((c) => ({ username: c.username, followedAt: c.followedAt, campaignId: c.campaignId })),
  };
}

export function unfollowPreviewToCsv(preview: UnfollowPreview): string {
  const header = 'username,followed_at,campaign_id';
  const lines = preview.proposed.map((r) => `${r.username},${r.followedAt},${r.campaignId ?? ''}`);
  return [header, ...lines].join('\n');
}

export interface FreezeUnfollowPlanResult {
  readonly plan: Plan;
  readonly itemCount: number;
  readonly window: CohortWindow;
}

/**
 * Congela um plano de unfollow imutável a partir dos candidatos elegíveis.
 */
export function freezeUnfollowPlan(
  db: SqliteDatabase,
  input: {
    localAccountId: string;
    filters: UnfollowFilters;
    preserveFollowBacks: boolean;
    followBackValidityDays: number;
    campaignId?: string;
    now?: Date;
  },
): FreezeUnfollowPlanResult {
  const now = input.now ?? new Date();
  const window = computeUnfollowWindow(input.filters, now);
  const candidates = loadUnfollowCohort(db, {
    localAccountId: input.localAccountId,
    window,
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
  });
  const options: UnfollowPreviewOptions = {
    preserveFollowBacks: input.preserveFollowBacks,
    followBackValidityDays: input.followBackValidityDays,
    ...(input.filters.excludeFollowers ? { excludeFollowers: true } : {}),
    ...(input.filters.limit ? { limit: input.filters.limit } : {}),
    now,
  };
  const eligible = selectEligibleUnfollowCandidates(candidates, options);

  const plans = new PlanRepo(db);
  const plan = plans.create({
    type: 'UNFOLLOW',
    criteria: {
      localAccountId: input.localAccountId,
      filters: input.filters,
      window: { fromIso: window.fromIso ?? null, toIso: window.toIso ?? null },
      usernames: eligible.map((c) => c.username),
    },
    config: {
      preserveFollowBacks: input.preserveFollowBacks,
      followBackValidityDays: input.followBackValidityDays,
      excludeFollowers: input.filters.excludeFollowers ?? false,
    },
  });

  eligible.forEach((candidate, index) => {
    plans.addItem({
      planId: plan.id,
      profileId: candidate.profileId,
      relationshipCycleId: candidate.cycleId,
      position: index,
      ...(candidate.campaignId ? { campaignId: candidate.campaignId } : {}),
      eligibilityReason: `followed_at=${candidate.followedAt};follow_back=${candidate.followBack}`,
      snapshot: { username: candidate.username, followedAt: candidate.followedAt },
    });
  });

  const frozen = plans.freeze(plan.id);
  return { plan: frozen, itemCount: eligible.length, window };
}

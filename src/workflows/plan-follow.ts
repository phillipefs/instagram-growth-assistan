import type { SqliteDatabase } from '../database/connection.js';
import type { DiscoverySource } from '../domain/discovery.js';
import { discoverySourcePriority } from '../domain/discovery.js';
import { PlanRepo, type Plan } from '../database/repositories/plans.js';

export interface PlanCandidate {
  readonly candidateId: string;
  readonly profileId: string;
  readonly username: string;
  readonly discoverySource: DiscoverySource;
  readonly score: number;
  readonly alreadyFollowing: boolean;
  readonly previouslyAttempted: boolean;
  readonly whitelisted: boolean;
  readonly protected: boolean;
}

export type ExclusionReason =
  'whitelisted' | 'protected' | 'already_following' | 'previously_attempted';

export interface FollowPreviewOptions {
  readonly limit?: number;
  readonly onlyUnattempted?: boolean;
}

export interface FollowPreview {
  readonly totalCollected: number;
  readonly totalApproved: number;
  readonly totalProposed: number;
  readonly excluded: Record<ExclusionReason, number>;
  readonly proposed: {
    readonly username: string;
    readonly score: number;
    readonly discoverySource: DiscoverySource;
  }[];
}

/**
 * Seleciona os candidatos aprovados, já ordenados por engajamento e limitados.
 * Exclui whitelist, protegidos e já seguidos.
 */
export function selectApprovedFollowCandidates(
  candidates: readonly PlanCandidate[],
  options: FollowPreviewOptions = {},
): PlanCandidate[] {
  const approved = candidates.filter(
    (c) =>
      !c.whitelisted &&
      !c.protected &&
      !c.alreadyFollowing &&
      !(options.onlyUnattempted && c.previouslyAttempted),
  );
  approved.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return discoverySourcePriority(a.discoverySource) - discoverySourcePriority(b.discoverySource);
  });
  return options.limit && options.limit > 0 ? approved.slice(0, options.limit) : approved;
}

/**
 * Constrói a prévia de follow (dry-run), ordenada por engajamento.
 *
 * Exclui whitelist, protegidos e já seguidos. Ordena por score decrescente e,
 * no empate, pela prioridade da fonte de descoberta. Nenhuma ação real ocorre.
 */
export function buildFollowPreview(
  candidates: readonly PlanCandidate[],
  options: FollowPreviewOptions = {},
): FollowPreview {
  const excluded: Record<ExclusionReason, number> = {
    whitelisted: 0,
    protected: 0,
    already_following: 0,
    previously_attempted: 0,
  };

  let approvedCount = 0;
  for (const candidate of candidates) {
    if (candidate.whitelisted) {
      excluded.whitelisted += 1;
    } else if (candidate.protected) {
      excluded.protected += 1;
    } else if (candidate.alreadyFollowing) {
      excluded.already_following += 1;
    } else if (options.onlyUnattempted && candidate.previouslyAttempted) {
      excluded.previously_attempted += 1;
    } else {
      approvedCount += 1;
    }
  }

  const limited = selectApprovedFollowCandidates(candidates, options);

  return {
    totalCollected: candidates.length,
    totalApproved: approvedCount,
    totalProposed: limited.length,
    excluded,
    proposed: limited.map((c) => ({
      username: c.username,
      score: c.score,
      discoverySource: c.discoverySource,
    })),
  };
}

interface PlanRow {
  readonly candidate_id: string;
  readonly profile_id: string;
  readonly username: string;
  readonly discovery_source: string;
  readonly score: number;
  readonly already_following: number;
  readonly previously_attempted: number;
  readonly whitelisted: number;
  readonly protected: number;
}

/**
 * Carrega os candidatos de uma campanha com score de engajamento e situação de
 * relacionamento para a conta local informada.
 */
export function loadFollowCandidates(
  db: SqliteDatabase,
  campaignId: string,
  localAccountId: string,
): PlanCandidate[] {
  const rows = db
    .prepare(
      `SELECT
         c.id AS candidate_id,
         c.profile_id AS profile_id,
         p.username_display AS username,
         c.discovery_source AS discovery_source,
         (
           SELECT COALESCE(SUM(CASE s.type
             WHEN 'COMMENT' THEN 3
             WHEN 'LIKE' THEN 2
             WHEN 'FOLLOWS_TARGET' THEN 1
             ELSE 0 END), 0)
           FROM candidate_signals s
           WHERE s.campaign_candidate_id = c.id
         ) AS score,
         CASE WHEN EXISTS (
           SELECT 1 FROM relationships r
           JOIN relationship_cycles rc ON rc.relationship_id = r.id
           WHERE r.local_account_id = @account
             AND r.profile_id = c.profile_id
             AND rc.unfollowed_at IS NULL
             AND rc.state IN ('FOLLOWING', 'FOLLOW_REQUESTED')
         ) THEN 1 ELSE 0 END AS already_following,
         CASE WHEN EXISTS (
           SELECT 1 FROM action_attempts a
           WHERE a.local_account_id = @account
             AND a.profile_id = c.profile_id
             AND a.action_type = 'FOLLOW'
         ) THEN 1 ELSE 0 END AS previously_attempted,
         COALESCE((SELECT whitelisted FROM relationships r WHERE r.local_account_id = @account AND r.profile_id = c.profile_id), 0) AS whitelisted,
         COALESCE((SELECT protected FROM relationships r WHERE r.local_account_id = @account AND r.profile_id = c.profile_id), 0) AS protected
       FROM campaign_candidates c
       JOIN profiles p ON p.id = c.profile_id
       WHERE c.campaign_id = @campaign
         AND c.state NOT IN ('REJECTED', 'SKIPPED')`,
    )
    .all({ campaign: campaignId, account: localAccountId }) as PlanRow[];

  return rows.map((row) => ({
    candidateId: row.candidate_id,
    profileId: row.profile_id,
    username: row.username,
    discoverySource: row.discovery_source as DiscoverySource,
    score: row.score,
    alreadyFollowing: row.already_following === 1,
    previouslyAttempted: row.previously_attempted === 1,
    whitelisted: row.whitelisted === 1,
    protected: row.protected === 1,
  }));
}

/** Serializa a prévia para CSV (sem dados sensíveis de sessão). */
export function followPreviewToCsv(preview: FollowPreview): string {
  const header = 'username,score,discovery_source';
  const lines = preview.proposed.map(
    (row) => `${row.username},${row.score},${row.discoverySource}`,
  );
  return [header, ...lines].join('\n');
}

export interface FreezeFollowPlanInput {
  readonly campaignId: string;
  readonly localAccountId: string;
  readonly limit?: number;
  readonly onlyUnattempted?: boolean;
  readonly configHashInput?: unknown;
}

export interface FreezeFollowPlanResult {
  readonly plan: Plan;
  readonly itemCount: number;
}

/**
 * Congela um plano de follow imutável a partir dos candidatos aprovados.
 * O plano guarda um snapshot ordenado; alterações posteriores exigem novo plano.
 */
export function freezeFollowPlan(
  db: SqliteDatabase,
  input: FreezeFollowPlanInput,
): FreezeFollowPlanResult {
  const candidates = loadFollowCandidates(db, input.campaignId, input.localAccountId);
  const approved = selectApprovedFollowCandidates(candidates, {
    ...(input.limit ? { limit: input.limit } : {}),
    ...(input.onlyUnattempted ? { onlyUnattempted: true } : {}),
  });

  const plans = new PlanRepo(db);
  const plan = plans.create({
    type: 'FOLLOW',
    criteria: {
      campaignId: input.campaignId,
      localAccountId: input.localAccountId,
      limit: input.limit ?? null,
      onlyUnattempted: input.onlyUnattempted ?? false,
      usernames: approved.map((c) => c.username),
    },
    config: input.configHashInput ?? {
      preserveExclusions: ['whitelist', 'protected', 'already_following'],
    },
  });

  approved.forEach((candidate, index) => {
    plans.addItem({
      planId: plan.id,
      profileId: candidate.profileId,
      campaignId: input.campaignId,
      position: index,
      eligibilityReason: `score=${candidate.score};source=${candidate.discoverySource}`,
      snapshot: {
        username: candidate.username,
        score: candidate.score,
        discoverySource: candidate.discoverySource,
      },
    });
  });

  const frozen = plans.freeze(plan.id);
  return { plan: frozen, itemCount: approved.length };
}

import type { SqliteDatabase } from '../database/connection.js';
import type { SafetyState } from '../domain/states.js';
import type { ProfileType } from '../browser/profile-detector.js';
import { assessFollowBack } from '../browser/followback-detector.js';
import { RelationshipRepo } from '../database/repositories/relationships.js';

export interface ReconcileItem {
  readonly cycleId: string;
  readonly relationshipId: string;
  readonly profileId: string;
  readonly username: string;
  readonly profileUrl: string;
}

export interface FollowBackInspection {
  readonly safetyState: SafetyState;
  readonly profileType: ProfileType;
  readonly followsYou: boolean;
  readonly notFollowingConfirmed?: boolean;
}

export interface FollowBackDriver {
  inspect(profileUrl: string): Promise<FollowBackInspection>;
}

export interface RunReconcileOptions {
  readonly limit: number;
  readonly accountShouldStop: boolean;
}

export interface ReconcileSummary {
  processed: number;
  yes: number;
  no: number;
  unknown: number;
  stopped: boolean;
  stopReason: string | null;
}

interface CycleRow {
  readonly cycle_id: string;
  readonly relationship_id: string;
  readonly profile_id: string;
  readonly username: string;
}

/**
 * Carrega apenas ciclos abertos ainda não inspecionados, opcionalmente por
 * campanha. Qualquer resultado persistido, inclusive `UNKNOWN`, possui
 * `follow_back_checked_at` e não volta para a fila.
 */
export function loadOpenCyclesForAccount(
  db: SqliteDatabase,
  localAccountId: string,
  campaignId?: string,
): ReconcileItem[] {
  const rows = db
    .prepare(
      `SELECT rc.id AS cycle_id, r.id AS relationship_id, r.profile_id AS profile_id, p.username_display AS username
         FROM relationship_cycles rc
         JOIN relationships r ON r.id = rc.relationship_id
         JOIN profiles p ON p.id = r.profile_id
        WHERE r.local_account_id = @account
          AND rc.unfollowed_at IS NULL
          AND rc.state IN ('FOLLOWING', 'FOLLOW_REQUESTED')
          AND rc.follow_back_checked_at IS NULL
          ${campaignId ? 'AND rc.campaign_id = @campaign' : ''}
        ORDER BY rc.created_at, rc.id`,
    )
    .all(
      campaignId ? { account: localAccountId, campaign: campaignId } : { account: localAccountId },
    ) as CycleRow[];

  return rows.map((row) => ({
    cycleId: row.cycle_id,
    relationshipId: row.relationship_id,
    profileId: row.profile_id,
    username: row.username,
    profileUrl: `https://www.instagram.com/${row.username}/`,
  }));
}

/**
 * Observa, em modo somente leitura, se cada candidato passou a seguir de volta e
 * salva o resultado no ciclo. Nenhum clique é executado.
 */
export async function runReconcile(
  db: SqliteDatabase,
  items: readonly ReconcileItem[],
  driver: FollowBackDriver,
  options: RunReconcileOptions,
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    processed: 0,
    yes: 0,
    no: 0,
    unknown: 0,
    stopped: false,
    stopReason: null,
  };
  const relationships = new RelationshipRepo(db);
  const cap = options.limit > 0 ? options.limit : items.length;

  for (const item of items.slice(0, cap)) {
    const inspection = await driver.inspect(item.profileUrl);
    const assessment = assessFollowBack(inspection);
    if (assessment.safetyState !== 'SAFE') {
      summary.stopped = true;
      summary.stopReason = `estado de segurança ${assessment.safetyState}`;
      break;
    }
    if (options.accountShouldStop) {
      summary.stopped = true;
      summary.stopReason = 'conta ativa divergente';
      break;
    }
    relationships.setFollowBack(item.cycleId, assessment.value);
    summary.processed += 1;
    if (assessment.value === 'YES') {
      summary.yes += 1;
    } else if (assessment.value === 'NO') {
      summary.no += 1;
    } else {
      summary.unknown += 1;
    }
  }
  return summary;
}

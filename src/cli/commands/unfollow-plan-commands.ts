import type { Command } from 'commander';
import { openAppDatabase } from '../../database/app-db.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { CampaignRepo } from '../../database/repositories/campaigns.js';
import { loadConfig } from '../../config/schema.js';
import { computeUnfollowWindow, type UnfollowFilters } from '../../domain/cohort.js';
import {
  buildUnfollowPreview,
  freezeUnfollowPlan,
  loadUnfollowCohort,
  unfollowPreviewToCsv,
} from '../../workflows/plan-unfollow.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

interface UnfollowOptions {
  olderThan?: string;
  followedWithin?: string;
  from?: string;
  to?: string;
  calendarMonth?: string;
  campaign?: string;
  excludeFollowers?: boolean;
  limit?: string;
  account?: string;
  export?: string;
}

function parseFilters(options: UnfollowOptions): UnfollowFilters {
  return {
    ...(options.olderThan ? { olderThanDays: Number.parseInt(options.olderThan, 10) } : {}),
    ...(options.followedWithin ? { followedWithinDays: Number.parseInt(options.followedWithin, 10) } : {}),
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {}),
    ...(options.calendarMonth ? { calendarMonth: options.calendarMonth } : {}),
    ...(options.excludeFollowers ? { excludeFollowers: true } : {}),
    ...(options.limit ? { limit: Number.parseInt(options.limit, 10) } : {}),
  };
}

function commonOptions(command: Command): Command {
  return command
    .option('--older-than <days>', 'seguidos há mais de N dias')
    .option('--followed-within <days>', 'seguidos nos últimos N dias')
    .option('--from <date>', 'data inicial (YYYY-MM-DD)')
    .option('--to <date>', 'data final (YYYY-MM-DD)')
    .option('--calendar-month <month>', 'mês de calendário (YYYY-MM)')
    .option('--campaign <name>', 'restringe a uma campanha')
    .option('--exclude-followers', 'exclui quem seguiu de volta')
    .option('--limit <n>', 'limita a quantidade')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)');
}

export function registerUnfollowPlanCommands(program: Command): void {
  commonOptions(
    program
      .command('plan-unfollow')
      .description('Prévia (dry-run) de unfollow por coorte. Nenhuma ação real.'),
  )
    .option('--export <format>', 'exporta a prévia: csv | json')
    .option('--dry-run', 'apenas prévia (sempre verdadeiro nesta fase)')
    .action((options: UnfollowOptions) => {
      const db = openAppDatabase();
      try {
        const accounts = new LocalAccountRepo(db);
        const account = options.account ? accounts.findByUsername(options.account) : accounts.list()[0];
        if (!account) {
          write({ error: 'Nenhuma conta local. Crie com account:create.' });
          process.exitCode = 1;
          return;
        }
        let campaignId: string | undefined;
        if (options.campaign) {
          const campaign = new CampaignRepo(db).findByName(options.campaign);
          if (!campaign) {
            write({ error: `Campanha não encontrada: ${options.campaign}` });
            process.exitCode = 1;
            return;
          }
          campaignId = campaign.id;
        }

        const filters = parseFilters(options);
        const config = loadConfig();
        const window = computeUnfollowWindow(filters);
        const candidates = loadUnfollowCohort(db, {
          localAccountId: account.id,
          window,
          ...(campaignId ? { campaignId } : {}),
        });
        const preview = buildUnfollowPreview(candidates, {
          preserveFollowBacks: config.unfollow.preserveFollowBacks,
          followBackValidityDays: config.unfollow.followBackValidityDays,
          ...(filters.excludeFollowers ? { excludeFollowers: true } : {}),
          ...(filters.limit ? { limit: filters.limit } : {}),
        });

        if (options.export === 'csv') {
          process.stdout.write(`${unfollowPreviewToCsv(preview)}\n`);
          return;
        }
        write({ account: account.username, dryRun: true, window: window.label, preview });
      } finally {
        db.close();
      }
    });

  commonOptions(
    program
      .command('plan:create-unfollow')
      .description('Congela um plano de unfollow imutável a partir dos candidatos elegíveis.'),
  ).action((options: UnfollowOptions) => {
    const db = openAppDatabase();
    try {
      const accounts = new LocalAccountRepo(db);
      const account = options.account ? accounts.findByUsername(options.account) : accounts.list()[0];
      if (!account) {
        write({ error: 'Nenhuma conta local. Crie com account:create.' });
        process.exitCode = 1;
        return;
      }
      let campaignId: string | undefined;
      if (options.campaign) {
        const campaign = new CampaignRepo(db).findByName(options.campaign);
        if (!campaign) {
          write({ error: `Campanha não encontrada: ${options.campaign}` });
          process.exitCode = 1;
          return;
        }
        campaignId = campaign.id;
      }

      const config = loadConfig();
      const result = freezeUnfollowPlan(db, {
        localAccountId: account.id,
        filters: parseFilters(options),
        preserveFollowBacks: config.unfollow.preserveFollowBacks,
        followBackValidityDays: config.unfollow.followBackValidityDays,
        ...(campaignId ? { campaignId } : {}),
      });
      write({
        ok: true,
        planId: result.plan.id,
        state: result.plan.state,
        itemCount: result.itemCount,
        window: result.window.label,
        criteriaHash: result.plan.criteriaHash,
      });
    } finally {
      db.close();
    }
  });
}

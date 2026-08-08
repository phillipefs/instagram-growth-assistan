import type { Command } from 'commander';
import { openAppDatabase } from '../../database/app-db.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { CampaignRepo } from '../../database/repositories/campaigns.js';
import { PlanRepo } from '../../database/repositories/plans.js';
import { RunRepo } from '../../database/repositories/runs.js';
import { freezeFollowPlan } from '../../workflows/plan-follow.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerPlanCommands(program: Command): void {
  program
    .command('plan:create-follow')
    .description('Congela um plano de follow imutável a partir dos candidatos aprovados.')
    .requiredOption('--campaign <name>', 'nome da campanha')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)')
    .option('--limit <n>', 'limita a quantidade de itens do plano')
    .option('--only-unattempted', 'exclui candidatos com qualquer tentativa anterior de follow')
    .action(
      (options: {
        campaign: string;
        account?: string;
        limit?: string;
        onlyUnattempted?: boolean;
      }) => {
        const db = openAppDatabase();
        try {
          const campaign = new CampaignRepo(db).findByName(options.campaign);
          if (!campaign) {
            write({ error: `Campanha não encontrada: ${options.campaign}` });
            process.exitCode = 1;
            return;
          }
          const accounts = new LocalAccountRepo(db);
          const account = options.account
            ? accounts.findByUsername(options.account)
            : accounts.list()[0];
          if (!account) {
            write({ error: 'Nenhuma conta local. Crie com account:create.' });
            process.exitCode = 1;
            return;
          }
          const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
          const result = freezeFollowPlan(db, {
            campaignId: campaign.id,
            localAccountId: account.id,
            ...(limit ? { limit } : {}),
            ...(options.onlyUnattempted ? { onlyUnattempted: true } : {}),
          });
          write({
            ok: true,
            planId: result.plan.id,
            state: result.plan.state,
            itemCount: result.itemCount,
            criteriaHash: result.plan.criteriaHash,
          });
        } finally {
          db.close();
        }
      },
    );

  program
    .command('plans:list')
    .description('Lista os planos.')
    .action(() => {
      const db = openAppDatabase();
      try {
        write({ plans: new PlanRepo(db).list() });
      } finally {
        db.close();
      }
    });

  program
    .command('plans:show')
    .description('Mostra um plano e seus itens.')
    .requiredOption('--plan <id>', 'id do plano')
    .action((options: { plan: string }) => {
      const db = openAppDatabase();
      try {
        const plans = new PlanRepo(db);
        const plan = plans.get(options.plan);
        if (!plan) {
          write({ error: `Plano não encontrado: ${options.plan}` });
          process.exitCode = 1;
          return;
        }
        write({ plan, progress: plans.progress(plan.id), items: plans.listItems(plan.id) });
      } finally {
        db.close();
      }
    });

  program
    .command('runs:list')
    .description('Lista as execuções.')
    .action(() => {
      const db = openAppDatabase();
      try {
        write({ runs: new RunRepo(db).list() });
      } finally {
        db.close();
      }
    });

  program
    .command('runs:show')
    .description('Mostra uma execução.')
    .requiredOption('--run <id>', 'id da execução')
    .action((options: { run: string }) => {
      const db = openAppDatabase();
      try {
        const run = new RunRepo(db).get(options.run);
        if (!run) {
          write({ error: `Execução não encontrada: ${options.run}` });
          process.exitCode = 1;
          return;
        }
        write({ run });
      } finally {
        db.close();
      }
    });
}

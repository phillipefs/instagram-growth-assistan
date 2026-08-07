import type { Command } from 'commander';
import { BrowserSession } from '../../browser/browser-session.js';
import { readProfileSignals } from '../../browser/read-profile.js';
import { assessProfile } from '../../browser/profile-detector.js';
import { readFollowsYou } from '../../browser/read-followback.js';
import { openAppDatabase } from '../../database/app-db.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { CampaignRepo } from '../../database/repositories/campaigns.js';
import { ActionAttemptRepo } from '../../database/repositories/actions.js';
import { ProfileRepo } from '../../database/repositories/profiles.js';
import { RunRepo } from '../../database/repositories/runs.js';
import { canonicalUsername } from '../../database/util.js';
import {
  loadOpenCyclesForAccount,
  runReconcile,
  type FollowBackDriver,
  type FollowBackInspection,
} from '../../workflows/reconcile-followback.js';
import { logger } from '../../observability/logger.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

class PlaywrightFollowBackDriver implements FollowBackDriver {
  constructor(private readonly session: BrowserSession) {}

  async inspect(profileUrl: string): Promise<FollowBackInspection> {
    await this.session.goto(profileUrl);
    const page = this.session.activePage;
    const assessment = assessProfile(await readProfileSignals(page));
    return {
      safetyState: assessment.safetyState,
      profileType: assessment.profileType,
      followsYou: await readFollowsYou(page),
    };
  }
}

export function registerReconcileCommands(program: Command): void {
  program
    .command('follow:skip-ambiguous')
    .description('Registra o skip manual de um follow ambíguo, sem repetir o clique.')
    .requiredOption('--run <id>', 'run que contém a tentativa ambígua')
    .requiredOption('--username <username>', 'perfil ambíguo a pular')
    .option(
      '--reason <text>',
      'justificativa registrada na auditoria',
      'skip manual explícito; resultado não confirmado',
    )
    .option('--confirm', 'confirma que o perfil não deve receber nova tentativa automática')
    .action(
      async (options: { run: string; username: string; reason: string; confirm?: boolean }) => {
        if (!options.confirm) {
          write({
            ok: false,
            error: 'Confirmação obrigatória. Revise o perfil e repita com --confirm.',
          });
          process.exitCode = 1;
          return;
        }

        const db = openAppDatabase();
        try {
          const run = new RunRepo(db).get(options.run);
          if (!run || run.type !== 'FOLLOW') {
            write({ ok: false, error: `Run de FOLLOW não encontrada: ${options.run}` });
            process.exitCode = 1;
            return;
          }

          const profile = new ProfileRepo(db).findByUsername(canonicalUsername(options.username));
          if (!profile) {
            write({ ok: false, error: `Perfil não encontrado: ${options.username}` });
            process.exitCode = 1;
            return;
          }

          const actions = new ActionAttemptRepo(db);
          const matches = actions
            .listByRunId(run.id)
            .filter(
              (attempt) =>
                attempt.actionType === 'FOLLOW' &&
                attempt.profileId === profile.id &&
                attempt.state === 'AMBIGUOUS',
            );
          if (matches.length !== 1) {
            write({
              ok: false,
              error: `Esperada exatamente uma tentativa FOLLOW ambígua; encontradas: ${matches.length}.`,
            });
            process.exitCode = 1;
            return;
          }

          const attempt = matches[0]!;
          const alreadyReconciled = actions.findReconciliation(attempt.id) !== undefined;
          const reconciliation = actions.reconcileAmbiguousAsSkipped(attempt.id, options.reason);
          write({
            ok: true,
            username: profile.usernameCanonical,
            runId: run.id,
            actionAttemptId: attempt.id,
            resolution: reconciliation.resolution,
            alreadyReconciled,
            warning:
              'A tentativa original continua AMBIGUOUS. Nenhum novo clique será feito e nenhum ciclo TOOL_CLICK foi criado para este perfil.',
          });
        } finally {
          db.close();
        }
      },
    );

  program
    .command('reconcile-followback')
    .description('Observa (somente leitura) quem passou a seguir de volta e registra o resultado.')
    .option('--campaign <name>', 'restringe aos ciclos de uma campanha')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)')
    .option('--limit <n>', 'máximo de perfis a verificar', '25')
    .option('--dry-run', 'apenas lista os ciclos que seriam verificados')
    .action(
      async (options: { campaign?: string; account?: string; limit: string; dryRun?: boolean }) => {
        const db = openAppDatabase();
        try {
          const accounts = new LocalAccountRepo(db);
          const account = options.account
            ? accounts.findByUsername(options.account)
            : accounts.list()[0];
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

          const items = loadOpenCyclesForAccount(db, account.id, campaignId);
          const limit = Number.parseInt(options.limit, 10) || 0;

          if (options.dryRun) {
            write({ dryRun: true, total: items.length, usernames: items.map((i) => i.username) });
            return;
          }

          const session = await BrowserSession.open({ visible: true });
          try {
            await session.goto();
            const report = await session.assess(account.username);
            if (report.assessment.safetyState !== 'SAFE') {
              write({
                ok: false,
                safetyState: report.assessment.safetyState,
                stopReason: 'sessão não segura',
              });
              process.exitCode = 1;
              return;
            }
            if (report.assessment.sessionStatus !== 'authenticated') {
              write({ ok: false, stopReason: 'sessão não autenticada; use session:open' });
              process.exitCode = 1;
              return;
            }
            const driver = new PlaywrightFollowBackDriver(session);
            const summary = await runReconcile(db, items, driver, {
              limit,
              accountShouldStop: report.account?.shouldStop ?? false,
            });
            logger.debug({ command: 'reconcile-followback' }, 'reconciliação concluída');
            write(summary);
          } finally {
            await session.close().catch(() => undefined);
          }
        } finally {
          db.close();
        }
      },
    );
}

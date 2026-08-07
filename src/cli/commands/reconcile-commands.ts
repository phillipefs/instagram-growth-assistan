import type { Command } from 'commander';
import { BrowserSession } from '../../browser/browser-session.js';
import { readProfileSignals } from '../../browser/read-profile.js';
import { assessProfile } from '../../browser/profile-detector.js';
import { readFollowsYou } from '../../browser/read-followback.js';
import { openAppDatabase } from '../../database/app-db.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { CampaignRepo } from '../../database/repositories/campaigns.js';
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
    .command('reconcile-followback')
    .description('Observa (somente leitura) quem passou a seguir de volta e registra o resultado.')
    .option('--campaign <name>', 'restringe aos ciclos de uma campanha')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)')
    .option('--limit <n>', 'máximo de perfis a verificar', '25')
    .option('--dry-run', 'apenas lista os ciclos que seriam verificados')
    .action(async (options: {
      campaign?: string;
      account?: string;
      limit: string;
      dryRun?: boolean;
    }) => {
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
            write({ ok: false, safetyState: report.assessment.safetyState, stopReason: 'sessão não segura' });
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
    });
}

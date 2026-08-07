import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { BrowserSession } from '../../browser/browser-session.js';
import { readProfileSignals } from '../../browser/read-profile.js';
import { assessProfile } from '../../browser/profile-detector.js';
import { readPageSafety } from '../../browser/read-signals.js';
import { readGridPosts, readLikeState, performLike } from '../../browser/like-action.js';
import { resolveDataPaths } from '../../config/paths.js';
import { loadConfig } from '../../config/schema.js';
import { openAppDatabase } from '../../database/app-db.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { ProfileRepo } from '../../database/repositories/profiles.js';
import { RunRepo } from '../../database/repositories/runs.js';
import { ActionAttemptRepo } from '../../database/repositories/actions.js';
import { applyDailyCap } from '../../workflows/daily-cap.js';
import {
  CampaignCandidateRepo,
  CampaignRepo,
} from '../../database/repositories/campaigns.js';
import {
  runLike,
  type LikeDriver,
  type LikeItem,
  type LikeMode,
  type OpenedPost,
  type ProfileForLike,
} from '../../workflows/like.js';
import { NOOP_CONFIRMER, StdinConfirmer } from './stdin-confirmer.js';

const LIKE_MODES: readonly LikeMode[] = ['dry-run', 'manual', 'confirm-each'];

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function profileUrlFor(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

const NOOP_LIKE_DRIVER: LikeDriver = {
  inspectProfile: () => Promise.reject(new Error('driver indisponível em dry-run')),
  openPost: () => Promise.reject(new Error('driver indisponível em dry-run')),
  performLike: () => Promise.reject(new Error('driver indisponível em dry-run')),
  screenshot: () => Promise.resolve(null),
};

class PlaywrightLikeDriver implements LikeDriver {
  constructor(
    private readonly session: BrowserSession,
    private readonly screenshotsDir: string,
  ) {}

  async inspectProfile(profileUrl: string): Promise<ProfileForLike> {
    await this.session.goto(profileUrl);
    const page = this.session.activePage;
    const assessment = assessProfile(await readProfileSignals(page));
    return {
      safetyState: assessment.safetyState,
      profileType: assessment.profileType,
      posts: await readGridPosts(page),
      finalUrl: page.url(),
    };
  }

  async openPost(shortcode: string): Promise<OpenedPost> {
    await this.session.goto(`https://www.instagram.com/p/${shortcode}/`);
    const page = this.session.activePage;
    return {
      safetyState: await readPageSafety(page),
      likeState: await readLikeState(page),
      postUrl: page.url(),
    };
  }

  performLike() {
    return performLike(this.session.activePage);
  }

  async screenshot(label: string): Promise<string | null> {
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    const target = path.join(this.screenshotsDir, `${label}-${Date.now()}.png`);
    await this.session.activePage.screenshot({ path: target });
    return target;
  }
}

export function registerLikeCommands(program: Command): void {
  program
    .command('like-post')
    .description('Curtir no máximo uma publicação recente por candidato (supervisionado).')
    .option('--campaign <name>', 'campanha de origem dos candidatos')
    .option('--username <username>', 'curtir apenas para um username')
    .option('--mode <mode>', 'dry-run | manual | confirm-each', 'dry-run')
    .option('--limit <n>', 'limite de ações reais (padrão 0)', '0')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)')
    .action(async (options: {
      campaign?: string;
      username?: string;
      mode: string;
      limit: string;
      account?: string;
    }) => {
      if (!LIKE_MODES.includes(options.mode as LikeMode)) {
        write({ error: `Modo inválido para curtida: ${options.mode}. Curtidas em lote não são suportadas.` });
        process.exitCode = 1;
        return;
      }
      const mode = options.mode as LikeMode;
      const limit = Number.parseInt(options.limit, 10) || 0;

      const db = openAppDatabase();
      try {
        const accounts = new LocalAccountRepo(db);
        const account = options.account ? accounts.findByUsername(options.account) : accounts.list()[0];
        if (!account) {
          write({ error: 'Nenhuma conta local. Crie com account:create.' });
          process.exitCode = 1;
          return;
        }

        const profiles = new ProfileRepo(db);
        let items: LikeItem[] = [];

        if (options.username) {
          const profile = profiles.findByUsername(options.username) ?? profiles.upsert({ username: options.username });
          items = [{ profileId: profile.id, username: profile.usernameCanonical, profileUrl: profileUrlFor(profile.usernameCanonical) }];
        } else if (options.campaign) {
          const campaign = new CampaignRepo(db).findByName(options.campaign);
          if (!campaign) {
            write({ error: `Campanha não encontrada: ${options.campaign}` });
            process.exitCode = 1;
            return;
          }
          items = new CampaignCandidateRepo(db).listByCampaign(campaign.id).map((c) => ({
            profileId: c.profileId,
            username: c.username,
            profileUrl: profileUrlFor(c.username),
            campaignId: campaign.id,
          }));
        } else {
          write({ error: 'Informe --campaign ou --username.' });
          process.exitCode = 1;
          return;
        }

        const config = loadConfig();
        const maxAgeDays = config.like.recentPostMaxAgeDays;

        if (mode === 'dry-run') {
          const summary = await runLike(db, items, NOOP_LIKE_DRIVER, NOOP_CONFIRMER, {
            mode,
            limit: 0,
            accountId: account.id,
            accountUsername: account.username,
            accountShouldStop: false,
            maxAgeDays,
          });
          write(summary);
          return;
        }

        const cap = applyDailyCap(
          new ActionAttemptRepo(db),
          account.id,
          'LIKE_POST',
          limit,
          config.execution.dailyActionCap,
        );
        if (cap.cap > 0 && cap.effectiveLimit <= 0) {
          write({
            ok: false,
            stopReason: 'teto diário atingido',
            dailyActionCap: cap.cap,
            alreadyToday: cap.alreadyToday,
          });
          return;
        }

        const runs = new RunRepo(db);
        const run = runs.create({
          type: 'LIKE_POST',
          mode,
          localAccountId: account.id,
        });
        runs.start(run.id);

        const session = await BrowserSession.open({ visible: true });
        const confirmer = new StdinConfirmer();
        try {
          await session.goto();
          const report = await session.assess(account.username);
          if (report.assessment.safetyState !== 'SAFE') {
            runs.finish(run.id, 'FAILED', 'sessão não segura');
            write({ ok: false, runId: run.id, safetyState: report.assessment.safetyState, stopReason: 'sessão não segura' });
            process.exitCode = 1;
            return;
          }
          if (report.assessment.sessionStatus !== 'authenticated') {
            runs.finish(run.id, 'FAILED', 'sessão não autenticada');
            write({ ok: false, runId: run.id, stopReason: 'sessão não autenticada; use session:open' });
            process.exitCode = 1;
            return;
          }
          const driver = new PlaywrightLikeDriver(session, resolveDataPaths().screenshots);
          const summary = await runLike(db, items, driver, confirmer, {
            mode,
            limit: cap.effectiveLimit,
            accountId: account.id,
            accountUsername: account.username,
            accountShouldStop: report.account?.shouldStop ?? false,
            maxAgeDays,
            runId: run.id,
          });
          runs.updateCounters(run.id, summary);
          runs.finish(run.id, summary.stopped ? 'STOPPED' : 'COMPLETED', summary.stopReason ?? undefined);
          write({ ...summary, runId: run.id });
        } finally {
          confirmer.close();
          await session.close().catch(() => undefined);
        }
      } finally {
        db.close();
      }
    });
}

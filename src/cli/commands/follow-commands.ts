import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { BrowserSession } from '../../browser/browser-session.js';
import { readProfileSignals } from '../../browser/read-profile.js';
import { assessProfile } from '../../browser/profile-detector.js';
import { performFollow } from '../../browser/follow-action.js';
import { readPageSafety } from '../../browser/read-signals.js';
import { readGridPosts, readLikeState, performLike } from '../../browser/like-action.js';
import { resolveDataPaths } from '../../config/paths.js';
import { openAppDatabase } from '../../database/app-db.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { ProfileRepo } from '../../database/repositories/profiles.js';
import { CampaignRepo } from '../../database/repositories/campaigns.js';
import { PlanRepo } from '../../database/repositories/plans.js';
import { RunRepo } from '../../database/repositories/runs.js';
import { ActionAttemptRepo } from '../../database/repositories/actions.js';
import { executionModeSchema, loadConfig } from '../../config/schema.js';
import {
  loadFollowCandidates,
  selectApprovedFollowCandidates,
} from '../../workflows/plan-follow.js';
import { applyDailyCap } from '../../workflows/daily-cap.js';
import { formatProgressLine } from '../format/run-report.js';
import {
  runFollow,
  type FollowDriver,
  type FollowInspection,
  type FollowItem,
} from '../../workflows/follow.js';
import type { LikeAfterFollowDriver, OpenedPost } from '../../workflows/like.js';
import { NOOP_CONFIRMER, StdinConfirmer } from './stdin-confirmer.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function profileUrlFor(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

const NOOP_DRIVER: FollowDriver = {
  inspect: () => Promise.reject(new Error('driver indisponível em dry-run')),
  performFollow: () => Promise.reject(new Error('driver indisponível em dry-run')),
  screenshot: () => Promise.resolve(null),
};

class PlaywrightFollowDriver implements FollowDriver {
  constructor(
    private readonly session: BrowserSession,
    private readonly screenshotsDir: string,
  ) {}

  async inspect(profileUrl: string): Promise<FollowInspection> {
    await this.session.goto(profileUrl);
    const page = this.session.activePage;
    const assessment = assessProfile(await readProfileSignals(page));
    return {
      safetyState: assessment.safetyState,
      relationship: assessment.relationshipState,
      finalUrl: page.url(),
      followersCount: assessment.followersCount,
      followingCount: assessment.followingCount,
    };
  }

  performFollow() {
    return performFollow(this.session.activePage);
  }

  async screenshot(label: string): Promise<string | null> {
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    const target = path.join(this.screenshotsDir, `${label}-${Date.now()}.png`);
    await this.session.activePage.screenshot({ path: target });
    return target;
  }
}

class PlaywrightFollowLikeDriver implements LikeAfterFollowDriver {
  constructor(
    private readonly session: BrowserSession,
    private readonly screenshotsDir: string,
  ) {}

  async readRecentPosts(profileUrl: string) {
    const page = this.session.activePage;
    // Logo após seguir já estamos no perfil; evita recarregar a página à toa.
    if (!page.url().startsWith(profileUrl)) {
      await this.session.goto(profileUrl);
    }
    return readGridPosts(this.session.activePage);
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

export function registerFollowCommands(program: Command): void {
  program
    .command('follow')
    .description(
      'Follow supervisionado. Padrão: dry-run. Ações reais exigem plano e limite positivo.',
    )
    .option('--plan <id>', 'plano de follow congelado (obrigatório fora do dry-run)')
    .option('--campaign <name>', 'campanha (apenas para dry-run)')
    .option('--mode <mode>', 'dry-run | manual | confirm-each | supervised-batch', 'dry-run')
    .option('--limit <n>', 'limite de ações reais (padrão 0)', '0')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)')
    .option(
      '--skip-inactive <n>',
      'pula perfis com menos de N seguidores; contador desconhecido não recebe clique',
    )
    .option('--like', 'ao seguir um perfil ABERTO, curte 1 publicação recente')
    .action(
      async (options: {
        plan?: string;
        campaign?: string;
        mode: string;
        limit: string;
        account?: string;
        skipInactive?: string;
        like?: boolean;
      }) => {
        const parsedMode = executionModeSchema.safeParse(options.mode);
        if (!parsedMode.success) {
          write({ error: `Modo inválido: ${options.mode}` });
          process.exitCode = 1;
          return;
        }
        const mode = parsedMode.data;
        const limit = Number.parseInt(options.limit, 10) || 0;
        const config = loadConfig();
        const skipInactiveBelow = options.skipInactive
          ? Number.parseInt(options.skipInactive, 10) || 0
          : config.follow.skipInactiveBelow;
        const likeAfterFollow = options.like === true;

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

          const profiles = new ProfileRepo(db);
          let items: FollowItem[] = [];
          let planFrozen = false;

          if (options.plan) {
            const plans = new PlanRepo(db);
            const plan = plans.get(options.plan);
            if (!plan) {
              write({ error: `Plano não encontrado: ${options.plan}` });
              process.exitCode = 1;
              return;
            }
            planFrozen = plan.state === 'FROZEN';
            items = plans.listItems(plan.id).map((it) => {
              const snapshot = it.snapshotJson
                ? (JSON.parse(it.snapshotJson) as { username?: string })
                : {};
              const username =
                snapshot.username ??
                profiles.findById(it.profileId)?.usernameCanonical ??
                it.profileId;
              return {
                profileId: it.profileId,
                username,
                profileUrl: profileUrlFor(username),
                planItemId: it.id,
                ...(it.campaignId ? { campaignId: it.campaignId } : {}),
              };
            });
          } else if (options.campaign) {
            if (mode !== 'dry-run') {
              write({
                error: 'Ações reais exigem um plano congelado (--plan). Use plan:create-follow.',
              });
              process.exitCode = 1;
              return;
            }
            const campaign = new CampaignRepo(db).findByName(options.campaign);
            if (!campaign) {
              write({ error: `Campanha não encontrada: ${options.campaign}` });
              process.exitCode = 1;
              return;
            }
            const approved = selectApprovedFollowCandidates(
              loadFollowCandidates(db, campaign.id, account.id),
              limit ? { limit } : {},
            );
            items = approved.map((c) => ({
              profileId: c.profileId,
              username: c.username,
              profileUrl: profileUrlFor(c.username),
              campaignId: campaign.id,
            }));
          } else {
            write({ error: 'Informe --plan (ações reais) ou --campaign (apenas dry-run).' });
            process.exitCode = 1;
            return;
          }

          if (mode === 'dry-run') {
            const summary = await runFollow(db, items, NOOP_DRIVER, NOOP_CONFIRMER, {
              mode,
              limit: 0,
              accountId: account.id,
              accountUsername: account.username,
              accountShouldStop: false,
              planFrozen,
            });
            write(summary);
            return;
          }

          if (!planFrozen) {
            write({ error: 'O plano informado não está congelado (FROZEN).' });
            process.exitCode = 1;
            return;
          }

          const cap = applyDailyCap(
            new ActionAttemptRepo(db),
            account.id,
            'FOLLOW',
            limit,
            loadConfig().execution.dailyActionCap,
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
          const effectiveLimit = cap.effectiveLimit;

          const runs = new RunRepo(db);
          const run = runs.create({
            type: 'FOLLOW',
            mode,
            localAccountId: account.id,
            ...(options.plan ? { planId: options.plan } : {}),
          });
          runs.start(run.id);

          const session = await BrowserSession.open({ visible: true });
          const confirmer = new StdinConfirmer();
          try {
            await session.goto();
            const report = await session.assess(account.username);
            if (report.assessment.safetyState !== 'SAFE') {
              runs.finish(run.id, 'FAILED', 'sessão não segura');
              write({
                ok: false,
                runId: run.id,
                safetyState: report.assessment.safetyState,
                stopReason: 'sessão não segura',
              });
              process.exitCode = 1;
              return;
            }
            if (report.assessment.sessionStatus !== 'authenticated') {
              runs.finish(run.id, 'FAILED', 'sessão não autenticada');
              write({
                ok: false,
                runId: run.id,
                stopReason: 'sessão não autenticada; use session:open',
              });
              process.exitCode = 1;
              return;
            }
            const driver = new PlaywrightFollowDriver(session, resolveDataPaths().screenshots);
            const likeDriver = likeAfterFollow
              ? new PlaywrightFollowLikeDriver(session, resolveDataPaths().screenshots)
              : undefined;
            const summary = await runFollow(db, items, driver, confirmer, {
              mode,
              limit: effectiveLimit,
              accountId: account.id,
              accountUsername: account.username,
              accountShouldStop: report.account?.shouldStop ?? false,
              planFrozen,
              runId: run.id,
              onProgress: (p) => process.stderr.write(`${formatProgressLine(p)}\n`),
              ...(skipInactiveBelow > 0 ? { skipInactiveBelow } : {}),
              ...(likeDriver
                ? {
                    likeAfterFollow: true,
                    likeMaxAgeDays: config.like.recentPostMaxAgeDays,
                    likeDriver,
                    onLike: (info) =>
                      process.stderr.write(`    \u21b3 like @${info.username}: ${info.outcome}\n`),
                  }
                : {}),
            });
            runs.updateCounters(run.id, summary);
            runs.finish(
              run.id,
              summary.stopped ? 'STOPPED' : 'COMPLETED',
              summary.stopReason ?? undefined,
            );
            write({ ...summary, runId: run.id });
          } finally {
            confirmer.close();
            await session.close().catch(() => undefined);
          }
        } finally {
          db.close();
        }
      },
    );
}

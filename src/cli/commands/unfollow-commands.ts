import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { BrowserSession } from '../../browser/browser-session.js';
import { readProfileSignals } from '../../browser/read-profile.js';
import { assessProfile } from '../../browser/profile-detector.js';
import { performUnfollow } from '../../browser/unfollow-action.js';
import { resolveDataPaths } from '../../config/paths.js';
import { executionModeSchema, loadConfig } from '../../config/schema.js';
import { openAppDatabase } from '../../database/app-db.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { ProfileRepo } from '../../database/repositories/profiles.js';
import { PlanRepo } from '../../database/repositories/plans.js';
import { RunRepo } from '../../database/repositories/runs.js';
import { ActionAttemptRepo } from '../../database/repositories/actions.js';
import { applyDailyCap } from '../../workflows/daily-cap.js';
import { formatProgressLine } from '../format/run-report.js';
import {
  runUnfollow,
  type UnfollowDriver,
  type UnfollowInspection,
  type UnfollowItem,
} from '../../workflows/unfollow.js';
import { NOOP_CONFIRMER, StdinConfirmer } from './stdin-confirmer.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function profileUrlFor(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

const NOOP_DRIVER: UnfollowDriver = {
  inspect: () => Promise.reject(new Error('driver indisponível em dry-run')),
  performUnfollow: () => Promise.reject(new Error('driver indisponível em dry-run')),
  screenshot: () => Promise.resolve(null),
};

class PlaywrightUnfollowDriver implements UnfollowDriver {
  constructor(
    private readonly session: BrowserSession,
    private readonly screenshotsDir: string,
  ) {}

  async inspect(profileUrl: string): Promise<UnfollowInspection> {
    await this.session.goto(profileUrl);
    const page = this.session.activePage;
    const assessment = assessProfile(await readProfileSignals(page));
    return {
      safetyState: assessment.safetyState,
      relationship: assessment.relationshipState,
      finalUrl: page.url(),
    };
  }

  performUnfollow() {
    return performUnfollow(this.session.activePage);
  }

  async screenshot(label: string): Promise<string | null> {
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    const target = path.join(this.screenshotsDir, `${label}-${Date.now()}.png`);
    await this.session.activePage.screenshot({ path: target });
    return target;
  }
}

export function registerUnfollowCommands(program: Command): void {
  program
    .command('unfollow')
    .description('Unfollow supervisionado a partir de um plano congelado. Padrão: dry-run.')
    .requiredOption('--plan <id>', 'plano de unfollow congelado')
    .option('--mode <mode>', 'dry-run | manual | confirm-each | supervised-batch', 'dry-run')
    .option('--limit <n>', 'limite de ações reais (padrão 0)', '0')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)')
    .action(async (options: { plan: string; mode: string; limit: string; account?: string }) => {
      const parsedMode = executionModeSchema.safeParse(options.mode);
      if (!parsedMode.success) {
        write({ error: `Modo inválido: ${options.mode}` });
        process.exitCode = 1;
        return;
      }
      const mode = parsedMode.data;
      const limit = Number.parseInt(options.limit, 10) || 0;
      const config = loadConfig();

      const db = openAppDatabase();
      try {
        const accounts = new LocalAccountRepo(db);
        const account = options.account ? accounts.findByUsername(options.account) : accounts.list()[0];
        if (!account) {
          write({ error: 'Nenhuma conta local. Crie com account:create.' });
          process.exitCode = 1;
          return;
        }

        const plans = new PlanRepo(db);
        const plan = plans.get(options.plan);
        if (!plan) {
          write({ error: `Plano não encontrado: ${options.plan}` });
          process.exitCode = 1;
          return;
        }
        if (plan.type !== 'UNFOLLOW') {
          write({ error: `O plano ${plan.id} não é do tipo UNFOLLOW.` });
          process.exitCode = 1;
          return;
        }
        const planFrozen = plan.state === 'FROZEN';

        const profiles = new ProfileRepo(db);
        const items: UnfollowItem[] = [];
        for (const it of plans.listItems(plan.id)) {
          if (!it.relationshipCycleId) {
            continue;
          }
          const snapshot = it.snapshotJson ? (JSON.parse(it.snapshotJson) as { username?: string }) : {};
          const username = snapshot.username ?? profiles.findById(it.profileId)?.usernameCanonical ?? it.profileId;
          items.push({
            profileId: it.profileId,
            username,
            profileUrl: profileUrlFor(username),
            relationshipCycleId: it.relationshipCycleId,
            planItemId: it.id,
            ...(it.campaignId ? { campaignId: it.campaignId } : {}),
          });
        }

        const runOptions = {
          mode,
          limit,
          accountId: account.id,
          accountUsername: account.username,
          preserveFollowBacks: config.unfollow.preserveFollowBacks,
          followBackValidityDays: config.unfollow.followBackValidityDays,
        };

        if (mode === 'dry-run') {
          const summary = await runUnfollow(db, items, NOOP_DRIVER, NOOP_CONFIRMER, {
            ...runOptions,
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
          'UNFOLLOW',
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
          type: 'UNFOLLOW',
          mode,
          localAccountId: account.id,
          planId: plan.id,
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
          const driver = new PlaywrightUnfollowDriver(session, resolveDataPaths().screenshots);
          const summary = await runUnfollow(db, items, driver, confirmer, {
            ...runOptions,
            limit: cap.effectiveLimit,
            accountShouldStop: report.account?.shouldStop ?? false,
            planFrozen,
            runId: run.id,
            onProgress: (p) => process.stderr.write(`${formatProgressLine(p)}\n`),
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

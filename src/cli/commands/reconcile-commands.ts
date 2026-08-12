import type { Command } from 'commander';
import { BrowserSession } from '../../browser/browser-session.js';
import { observePositiveProfileRelationship } from '../../browser/profile-network-relationship.js';
import {
  readFollowersList,
  type FollowersListSnapshot,
} from '../../browser/read-followers-list.js';
import { openAppDatabase } from '../../database/app-db.js';
import { withTransaction } from '../../database/connection.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { CampaignRepo } from '../../database/repositories/campaigns.js';
import { ActionAttemptRepo } from '../../database/repositories/actions.js';
import { RelationshipRepo } from '../../database/repositories/relationships.js';
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
  private constructor(private readonly snapshot: FollowersListSnapshot) {}

  static async create(
    session: BrowserSession,
    accountUsername: string,
  ): Promise<PlaywrightFollowBackDriver> {
    const account = canonicalUsername(accountUsername);
    const profile = await session.inspectProfile(`https://www.instagram.com/${account}/`);
    if (
      profile.assessment.safetyState !== 'SAFE' ||
      canonicalUsername(profile.assessment.username ?? '') !== account
    ) {
      return new PlaywrightFollowBackDriver({
        complete: false,
        expectedCount: profile.assessment.followersCount,
        loadedCount: 0,
        usernames: new Set<string>(),
        reason: `perfil da conta ativa não reconhecido com segurança (${profile.assessment.safetyState})`,
      });
    }
    const snapshot = await readFollowersList(
      session.activePage,
      account,
      profile.assessment.followersCount,
    );
    return new PlaywrightFollowBackDriver(snapshot);
  }

  get report(): Omit<FollowersListSnapshot, 'usernames'> {
    return {
      complete: this.snapshot.complete,
      expectedCount: this.snapshot.expectedCount,
      loadedCount: this.snapshot.loadedCount,
      reason: this.snapshot.reason,
    };
  }

  async inspect(profileUrl: string): Promise<FollowBackInspection> {
    let username: string;
    try {
      username = canonicalUsername(
        new URL(profileUrl).pathname.split('/').filter(Boolean)[0] ?? '',
      );
    } catch {
      return {
        safetyState: 'UNKNOWN_INTERFACE',
        profileType: 'UNKNOWN',
        followsYou: false,
      };
    }
    const followsYou = this.snapshot.usernames.has(username);
    return {
      safetyState: this.snapshot.complete ? 'SAFE' : 'UNKNOWN_INTERFACE',
      profileType: 'UNKNOWN',
      followsYou,
      notFollowingConfirmed: this.snapshot.complete && !followsYou,
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
    .command('follow:confirm-ambiguous')
    .description('Confirma por leitura um follow ambíguo, sem repetir o clique.')
    .requiredOption('--run <id>', 'run que contém a tentativa ambígua')
    .requiredOption('--username <username>', 'perfil ambíguo a verificar')
    .option('--confirm', 'autoriza registrar a confirmação observada localmente')
    .action(async (options: { run: string; username: string; confirm?: boolean }) => {
      if (!options.confirm) {
        write({ ok: false, error: 'Confirmação obrigatória. Repita com --confirm.' });
        process.exitCode = 1;
        return;
      }

      const db = openAppDatabase();
      let session: BrowserSession | null = null;
      try {
        const run = new RunRepo(db).get(options.run);
        if (!run || run.type !== 'FOLLOW') {
          throw new Error(`Run de FOLLOW não encontrada: ${options.run}`);
        }
        if (!run.localAccountId) {
          throw new Error(`Run sem conta local: ${run.id}`);
        }
        const account = new LocalAccountRepo(db).findById(run.localAccountId);
        if (!account) {
          throw new Error(`Conta local não encontrada: ${run.localAccountId}`);
        }
        const profile = new ProfileRepo(db).findByUsername(canonicalUsername(options.username));
        if (!profile) {
          throw new Error(`Perfil não encontrado: ${options.username}`);
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
          throw new Error(
            `Esperada exatamente uma tentativa FOLLOW ambígua; encontradas: ${matches.length}.`,
          );
        }
        const attempt = matches[0]!;

        session = await BrowserSession.open({ visible: true });
        await session.goto();
        const sessionReport = await session.assess(account.username);
        if (
          sessionReport.assessment.safetyState !== 'SAFE' ||
          sessionReport.assessment.sessionStatus !== 'authenticated' ||
          sessionReport.account?.shouldStop
        ) {
          throw new Error('Sessão ou conta ativa não está segura para reconciliar.');
        }
        const network = observePositiveProfileRelationship(
          session.activePage,
          profile.usernameCanonical,
        );
        let observed: Awaited<ReturnType<BrowserSession['inspectProfile']>>;
        let relationship: 'FOLLOWING' | 'FOLLOW_REQUESTED' | 'UNKNOWN';
        try {
          observed = await session.inspectProfile(
            `https://www.instagram.com/${profile.usernameCanonical}/`,
          );
          const visualRelationship = observed.assessment.relationshipState;
          relationship =
            visualRelationship === 'FOLLOWING' || visualRelationship === 'FOLLOW_REQUESTED'
              ? visualRelationship
              : ((await network.waitFor(500)) ?? 'UNKNOWN');
        } finally {
          network.dispose();
        }
        if (
          observed.assessment.safetyState !== 'SAFE' ||
          canonicalUsername(observed.assessment.username ?? '') !== profile.usernameCanonical ||
          (relationship !== 'FOLLOWING' && relationship !== 'FOLLOW_REQUESTED')
        ) {
          throw new Error(
            `Relacionamento não confirmado por leitura: ${relationship} (${observed.assessment.safetyState}).`,
          );
        }

        const result = withTransaction(db, () => {
          const confirmed = actions.reconcileAmbiguousAsConfirmed(
            attempt.id,
            `reconciliado por leitura posterior: ${relationship}`,
          );
          const relationships = new RelationshipRepo(db);
          const relation = relationships.ensure(account.id, profile.id);
          const existingCycle = relationships.getOpenCycle(relation.id);
          const cycle =
            existingCycle ??
            relationships.createCycle({
              relationshipId: relation.id,
              origin: 'TOOL_CLICK',
              state: relationship,
              ...(attempt.campaignId ? { campaignId: attempt.campaignId } : {}),
              followRunId: run.id,
              ...(relationship === 'FOLLOW_REQUESTED' && attempt.startedAt
                ? { followRequestedAt: attempt.startedAt }
                : {}),
              ...(relationship === 'FOLLOWING' && attempt.startedAt
                ? { followedAt: attempt.startedAt }
                : {}),
            });
          return { confirmed, cycle };
        });

        write({
          ok: true,
          username: profile.usernameCanonical,
          relationship,
          actionAttemptId: result.confirmed.id,
          relationshipCycleId: result.cycle.id,
          warning: 'Reconciliação somente leitura; nenhum clique foi executado.',
        });
      } catch (error) {
        write({ ok: false, error: error instanceof Error ? error.message : String(error) });
        process.exitCode = 1;
      } finally {
        await session?.close().catch(() => undefined);
        db.close();
      }
    });

  program
    .command('unfollow:confirm-unresolved')
    .description('Confirma por leitura um unfollow FAILED/AMBIGUOUS, sem repetir o clique.')
    .requiredOption('--run <id>', 'run que contém a tentativa não resolvida')
    .requiredOption('--username <username>', 'perfil cujo unfollow será verificado')
    .option('--confirm', 'autoriza registrar a confirmação observada localmente')
    .action(async (options: { run: string; username: string; confirm?: boolean }) => {
      if (!options.confirm) {
        write({ ok: false, error: 'Confirmação obrigatória. Repita com --confirm.' });
        process.exitCode = 1;
        return;
      }

      const db = openAppDatabase();
      let session: BrowserSession | null = null;
      try {
        const run = new RunRepo(db).get(options.run);
        if (!run || run.type !== 'UNFOLLOW') {
          throw new Error(`Run de UNFOLLOW não encontrada: ${options.run}`);
        }
        if (!run.localAccountId) {
          throw new Error(`Run sem conta local: ${run.id}`);
        }
        const account = new LocalAccountRepo(db).findById(run.localAccountId);
        if (!account) {
          throw new Error(`Conta local não encontrada: ${run.localAccountId}`);
        }
        const profile = new ProfileRepo(db).findByUsername(canonicalUsername(options.username));
        if (!profile) {
          throw new Error(`Perfil não encontrado: ${options.username}`);
        }
        const actions = new ActionAttemptRepo(db);
        const matches = actions
          .listByRunId(run.id)
          .filter(
            (attempt) =>
              attempt.actionType === 'UNFOLLOW' &&
              attempt.profileId === profile.id &&
              (attempt.state === 'FAILED' || attempt.state === 'AMBIGUOUS'),
          );
        if (matches.length !== 1) {
          throw new Error(
            `Esperada exatamente uma tentativa UNFOLLOW FAILED/AMBIGUOUS; encontradas: ${matches.length}.`,
          );
        }
        const attempt = matches[0]!;
        if (!attempt.relationshipCycleId) {
          throw new Error(`Tentativa sem ciclo de relacionamento: ${attempt.id}`);
        }

        session = await BrowserSession.open({ visible: true });
        await session.goto();
        const sessionReport = await session.assess(account.username);
        if (
          sessionReport.assessment.safetyState !== 'SAFE' ||
          sessionReport.assessment.sessionStatus !== 'authenticated' ||
          sessionReport.account?.shouldStop
        ) {
          throw new Error('Sessão ou conta ativa não está segura para reconciliar.');
        }
        const observed = await session.inspectProfile(
          `https://www.instagram.com/${profile.usernameCanonical}/`,
        );
        if (
          observed.assessment.safetyState !== 'SAFE' ||
          canonicalUsername(observed.assessment.username ?? '') !== profile.usernameCanonical ||
          observed.assessment.relationshipState !== 'NOT_FOLLOWING'
        ) {
          throw new Error(
            `Unfollow não confirmado por leitura: ${observed.assessment.relationshipState} (${observed.assessment.safetyState}).`,
          );
        }

        const result = withTransaction(db, () => {
          const confirmed = actions.reconcileUnfollowAsConfirmed(
            attempt.id,
            'reconciliado por leitura posterior: NOT_FOLLOWING',
          );
          const relationships = new RelationshipRepo(db);
          const cycle = relationships.findCycleById(attempt.relationshipCycleId!);
          if (!cycle) {
            throw new Error(
              `Ciclo de relacionamento não encontrado: ${attempt.relationshipCycleId}`,
            );
          }
          if (!cycle.unfollowedAt) {
            relationships.closeCycle(cycle.id, {
              unfollowReason: 'reconciliado por leitura posterior: NOT_FOLLOWING',
            });
          }
          return { confirmed, cycleId: cycle.id };
        });

        write({
          ok: true,
          username: profile.usernameCanonical,
          relationship: 'NOT_FOLLOWING',
          actionAttemptId: result.confirmed.id,
          relationshipCycleId: result.cycleId,
          warning: 'Reconciliação somente leitura; nenhum clique foi executado.',
        });
      } catch (error) {
        write({ ok: false, error: error instanceof Error ? error.message : String(error) });
        process.exitCode = 1;
      } finally {
        await session?.close().catch(() => undefined);
        db.close();
      }
    });

  program
    .command('reconcile-followback')
    .description(
      'Observa (somente leitura) follow-backs ainda não inspecionados e registra o resultado.',
    )
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
            const driver = await PlaywrightFollowBackDriver.create(session, account.username);
            const summary = await runReconcile(db, items, driver, {
              limit,
              accountShouldStop: report.account?.shouldStop ?? false,
            });
            logger.debug({ command: 'reconcile-followback' }, 'reconciliação concluída');
            write({
              ...summary,
              source: 'active-account-followers-list',
              followersList: driver.report,
            });
          } finally {
            await session.close().catch(() => undefined);
          }
        } finally {
          db.close();
        }
      },
    );
}

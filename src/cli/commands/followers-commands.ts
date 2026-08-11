import type { Command } from 'commander';
import { BrowserSession } from '../../browser/browser-session.js';
import { readFollowersList } from '../../browser/read-followers-list.js';
import { openAppDatabase } from '../../database/app-db.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { FollowerSnapshotRepo } from '../../database/repositories/follower-snapshots.js';
import { ProfileRepo } from '../../database/repositories/profiles.js';
import { canonicalUsername } from '../../database/util.js';
import {
  FOLLOWER_SNAPSHOT_TOLERANCE_PCT,
  isWithinFollowerSnapshotTolerance,
  persistFollowerSnapshot,
} from '../../workflows/sync-followers.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerFollowersCommands(program: Command): void {
  program
    .command('followers:sync')
    .description('Carrega a lista completa de seguidores e salva um snapshot local imutável.')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)')
    .option('--dry-run', 'carrega e valida a lista, mas não altera o banco')
    .action(async (options: { account?: string; dryRun?: boolean }) => {
      const db = openAppDatabase();
      let session: BrowserSession | null = null;
      try {
        const accounts = new LocalAccountRepo(db);
        const account = options.account
          ? accounts.findByUsername(options.account)
          : accounts.list()[0];
        if (!account) {
          write({ ok: false, error: 'Nenhuma conta local. Crie com account:create.' });
          process.exitCode = 1;
          return;
        }

        session = await BrowserSession.open({ visible: true });
        await session.goto();
        const sessionReport = await session.assess(account.username);
        if (
          sessionReport.assessment.safetyState !== 'SAFE' ||
          sessionReport.assessment.sessionStatus !== 'authenticated' ||
          sessionReport.account?.shouldStop
        ) {
          write({
            ok: false,
            safetyState: sessionReport.assessment.safetyState,
            sessionStatus: sessionReport.assessment.sessionStatus,
            accountMatch: sessionReport.account?.match ?? null,
            stopReason: 'sessão ou conta ativa não está segura para o sync',
          });
          process.exitCode = 1;
          return;
        }

        const canonicalAccount = canonicalUsername(account.username);
        const profile = await session.inspectProfile(
          `https://www.instagram.com/${canonicalAccount}/`,
        );
        if (
          profile.assessment.safetyState !== 'SAFE' ||
          canonicalUsername(profile.assessment.username ?? '') !== canonicalAccount
        ) {
          write({
            ok: false,
            safetyState: profile.assessment.safetyState,
            stopReason: 'perfil da conta ativa não reconhecido com segurança',
          });
          process.exitCode = 1;
          return;
        }

        const observedAt = new Date().toISOString();
        const list = await readFollowersList(
          session.activePage,
          canonicalAccount,
          profile.assessment.followersCount,
        );
        if (options.dryRun) {
          const acceptedByTolerance = isWithinFollowerSnapshotTolerance(
            list.expectedCount,
            list.loadedCount,
          );
          write({
            ok: list.complete || acceptedByTolerance,
            dryRun: true,
            account: account.username,
            observedAt,
            expectedCount: list.expectedCount,
            loadedCount: list.loadedCount,
            complete: list.complete,
            acceptedByTolerance,
            tolerancePct: FOLLOWER_SNAPSHOT_TOLERANCE_PCT,
            reason: list.reason,
          });
          if (!list.complete && !acceptedByTolerance) process.exitCode = 1;
          return;
        }

        const result = persistFollowerSnapshot(db, {
          localAccountId: account.id,
          complete: list.complete,
          expectedCount: list.expectedCount,
          loadedCount: list.loadedCount,
          usernames: [...list.usernames],
          observedAt,
          reason: list.reason,
        });
        write({
          ok: result.snapshot.status !== 'INCOMPLETE',
          account: account.username,
          snapshotId: result.snapshot.id,
          status: result.snapshot.status,
          observedAt: result.snapshot.observedAt,
          expectedCount: result.snapshot.expectedCount,
          loadedCount: result.snapshot.loadedCount,
          membersStored: result.membersStored,
          relationshipCyclesUpdated: result.relationshipCyclesUpdated,
          acceptedByTolerance: result.acceptedByTolerance,
          tolerancePct: FOLLOWER_SNAPSHOT_TOLERANCE_PCT,
          failureReason: result.snapshot.failureReason,
        });
        if (result.snapshot.status === 'INCOMPLETE') process.exitCode = 1;
      } finally {
        await session?.close().catch(() => undefined);
        db.close();
      }
    });

  program
    .command('followers:status')
    .description('Mostra os snapshots locais de seguidores sem abrir o navegador.')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)')
    .option('--limit <n>', 'quantidade de snapshots no histórico', '10')
    .option('--check <username>', 'confere um username no snapshot completo mais recente')
    .action((options: { account?: string; limit: string; check?: string }) => {
      const db = openAppDatabase();
      try {
        const accounts = new LocalAccountRepo(db);
        const account = options.account
          ? accounts.findByUsername(options.account)
          : accounts.list()[0];
        if (!account) {
          write({ ok: false, error: 'Nenhuma conta local. Crie com account:create.' });
          process.exitCode = 1;
          return;
        }
        const snapshots = new FollowerSnapshotRepo(db);
        const latest = snapshots.latestComplete(account.id);
        const latestAccepted = snapshots.latestAccepted(account.id);
        const checkedProfile = options.check
          ? new ProfileRepo(db).findByUsername(options.check)
          : undefined;
        write({
          account: account.username,
          latestComplete: latest ?? null,
          latestAccepted: latestAccepted ?? null,
          ...(options.check
            ? {
                check: {
                  username: canonicalUsername(options.check),
                  isFollower:
                    latestAccepted !== undefined &&
                    checkedProfile !== undefined &&
                    snapshots.isMember(latestAccepted.id, checkedProfile.id)
                      ? true
                      : latestAccepted?.status === 'COMPLETE'
                        ? false
                        : null,
                  snapshotId: latestAccepted?.id ?? null,
                  snapshotStatus: latestAccepted?.status ?? null,
                  observedAt: latestAccepted?.observedAt ?? null,
                },
              }
            : {}),
          history: snapshots.list(account.id, Number.parseInt(options.limit, 10) || 10),
        });
      } finally {
        db.close();
      }
    });
}

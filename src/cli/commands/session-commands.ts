import type { Command } from 'commander';
import { BrowserSession, clearBrowserProfile } from '../../browser/browser-session.js';
import { resolveDataPaths } from '../../config/paths.js';
import { logger } from '../../observability/logger.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerSessionCommands(program: Command): void {
  program
    .command('session:open')
    .description('Abre o navegador visível para login manual. Faça login e feche a janela.')
    .action(async () => {
      write({
        message:
          'Abrindo navegador visível. Faça login manualmente. Nenhuma credencial é preenchida ou armazenada. Feche a janela para encerrar.',
        profile: resolveDataPaths().browserProfile,
      });
      const session = await BrowserSession.open({ visible: true });
      try {
        await session.goto();
        await session.waitUntilClosed();
      } finally {
        await session.close().catch(() => undefined);
      }
      write({ ok: true, message: 'Navegador encerrado.' });
    });

  program
    .command('session:check')
    .description('Verifica a sessão em modo somente leitura e relata o estado.')
    .option('--account <username>', 'conta local configurada para comparação')
    .action(async (options: { account?: string }) => {
      const session = await BrowserSession.open({ visible: true });
      try {
        await session.goto();
        const report = await session.assess(options.account ?? null);
        logger.debug({ command: 'session:check' }, 'sessão avaliada');
        write({
          browserProfile: 'configurado',
          visibleBrowser: 'sim',
          session: report.assessment.sessionStatus,
          activeAccount: report.assessment.activeAccount ?? 'desconhecida',
          safetyState: report.assessment.safetyState,
          accountMatch: report.account?.match ?? 'n/a',
        });
      } finally {
        await session.close().catch(() => undefined);
      }
    });

  program
    .command('session:clear')
    .description('Apaga o perfil local do navegador. Requer --confirm.')
    .option('--confirm', 'confirma explicitamente a remoção do perfil')
    .action((options: { confirm?: boolean }) => {
      if (!options.confirm) {
        write({ error: 'Operação destrutiva. Repita com --confirm para apagar o perfil local.' });
        process.exitCode = 1;
        return;
      }
      const dir = clearBrowserProfile();
      write({ ok: true, message: `Perfil local apagado: ${dir}` });
    });

  program
    .command('inspect-profile')
    .description('Reconhece um perfil em modo somente leitura (sem cliques).')
    .requiredOption('--url <url>', 'URL do perfil a inspecionar')
    .action(async (options: { url: string }) => {
      const session = await BrowserSession.open({ visible: true });
      try {
        const report = await session.inspectProfile(options.url);
        logger.debug({ command: 'inspect-profile' }, 'perfil reconhecido');
        write({
          requestedUrl: report.requestedUrl,
          finalUrl: report.finalUrl,
          username: report.assessment.username ?? 'desconhecido',
          profileType: report.assessment.profileType,
          relationshipState: report.assessment.relationshipState,
          hasFollowersAccess: report.assessment.hasFollowersAccess,
          hasPosts: report.assessment.hasPosts,
          postsVisible: report.assessment.postsVisible,
          followersCount: report.assessment.followersCount,
          followingCount: report.assessment.followingCount,
          safetyState: report.assessment.safetyState,
          unknownFields: report.assessment.unknownFields,
        });
      } finally {
        await session.close().catch(() => undefined);
      }
    });
}

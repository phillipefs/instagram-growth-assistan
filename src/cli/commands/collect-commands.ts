import type { Command } from 'commander';
import { BrowserSession } from '../../browser/browser-session.js';
import { openAppDatabase } from '../../database/app-db.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { ProfileRepo } from '../../database/repositories/profiles.js';
import { CampaignCandidateRepo, CampaignRepo } from '../../database/repositories/campaigns.js';
import { CandidateSignalRepo } from '../../database/repositories/candidate-signals.js';
import { ingestDiscovered } from '../../workflows/collect.js';
import {
  collectFromTarget,
  commentLoadRoundsFor,
  normalizeCommentsPerPost,
} from '../../workflows/collect-browser.js';
import { logger } from '../../observability/logger.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerCollectCommands(program: Command): void {
  program
    .command('collect')
    .description('Coleta candidatos engajados do perfil-alvo (somente leitura, navegador visível).')
    .requiredOption('--campaign <name>', 'nome da campanha')
    .option('--limit <n>', 'máximo de candidatos únicos', '30')
    .option('--posts <n>', 'máximo de publicações recentes a abrir', '6')
    .option('--skip-posts <n>', 'pula os primeiros N posts do grid (ex.: fixados)', '0')
    .option('--comments-per-post <n>', 'máximo de comentaristas extraídos por post', '80')
    .option('--likers', 'também tentar curtidores (best-effort; muitas vezes oculto)')
    .option('--account <username>', 'conta local esperada para validação')
    .action(
      async (options: {
        campaign: string;
        limit: string;
        posts: string;
        skipPosts: string;
        commentsPerPost: string;
        likers?: boolean;
        account?: string;
      }) => {
        const db = openAppDatabase();
        try {
          const campaign = new CampaignRepo(db).findByName(options.campaign);
          if (!campaign) {
            write({ error: `Campanha não encontrada: ${options.campaign}` });
            process.exitCode = 1;
            return;
          }
          const target = campaign.targetProfileId
            ? new ProfileRepo(db).findById(campaign.targetProfileId)
            : undefined;
          const targetUrl =
            campaign.targetUrl ??
            (target ? `https://www.instagram.com/${target.usernameCanonical}/` : null);
          if (!targetUrl) {
            write({ error: 'Campanha sem perfil-alvo. Recrie com campaign:create.' });
            process.exitCode = 1;
            return;
          }

          const configuredAccount =
            options.account ?? new LocalAccountRepo(db).list()[0]?.username ?? null;
          const requestedCommentsPerPost = Number.parseInt(options.commentsPerPost, 10);
          if (!Number.isFinite(requestedCommentsPerPost) || requestedCommentsPerPost <= 0) {
            write({ error: '--comments-per-post exige um inteiro positivo.' });
            process.exitCode = 1;
            return;
          }
          const commentsPerPost = normalizeCommentsPerPost(requestedCommentsPerPost);

          const session = await BrowserSession.open({ visible: true });
          let result;
          try {
            result = await collectFromTarget(session, {
              targetUrl,
              limit: Number.parseInt(options.limit, 10),
              postsLimit: Number.parseInt(options.posts, 10),
              skipPosts: Number.parseInt(options.skipPosts, 10) || 0,
              commentsPerPost,
              includeLikers: options.likers ?? false,
              configuredAccount,
            });
          } finally {
            await session.close().catch(() => undefined);
          }

          if (result.stoppedReason) {
            write({
              ok: false,
              safetyState: result.safetyState,
              stoppedReason: result.stoppedReason,
            });
            process.exitCode = 1;
            return;
          }

          const summary = ingestDiscovered(
            {
              profiles: new ProfileRepo(db),
              candidates: new CampaignCandidateRepo(db),
              signals: new CandidateSignalRepo(db),
            },
            campaign.id,
            result.items,
          );

          logger.debug({ command: 'collect' }, 'coleta concluída');
          write({
            ok: true,
            campaign: campaign.name,
            postsVisited: result.postsVisited,
            likersUnavailable: result.likersUnavailable,
            commentsPerPost,
            commentLoadRounds: commentLoadRoundsFor(commentsPerPost),
            ...summary,
          });
        } finally {
          db.close();
        }
      },
    );
}

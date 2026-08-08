import type { Command } from 'commander';
import { openAppDatabase, resetDatabase } from '../../database/app-db.js';
import { migrationStatus } from '../../database/migrator.js';
import { MIGRATIONS } from '../../database/migrations/index.js';
import { LocalAccountRepo } from '../../database/repositories/accounts.js';
import { ProfileRepo } from '../../database/repositories/profiles.js';
import { CampaignCandidateRepo, CampaignRepo } from '../../database/repositories/campaigns.js';
import { RelationshipRepo } from '../../database/repositories/relationships.js';
import { ActionAttemptRepo } from '../../database/repositories/actions.js';
import { canonicalUsername } from '../../database/util.js';
import {
  buildFollowPreview,
  followPreviewToCsv,
  loadFollowCandidates,
} from '../../workflows/plan-follow.js';
import { buildCampaignSummary } from '../../workflows/campaign-summary.js';
import { buildTargetSummary } from '../../workflows/target-summary.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerDataCommands(program: Command): void {
  program
    .command('db:migrate')
    .description('Cria/migra o banco de dados local.')
    .action(() => {
      const db = openAppDatabase();
      try {
        write({ status: migrationStatus(db, MIGRATIONS) });
      } finally {
        db.close();
      }
    });

  program
    .command('db:status')
    .description('Mostra o estado das migrações.')
    .action(() => {
      const db = openAppDatabase();
      try {
        write({ migrations: migrationStatus(db, MIGRATIONS) });
      } finally {
        db.close();
      }
    });

  program
    .command('db:reset')
    .description('Reseta os dados locais de teste. Requer --confirm.')
    .option('--confirm', 'confirma explicitamente o reset destrutivo')
    .action((options: { confirm?: boolean }) => {
      if (!options.confirm) {
        write({ error: 'Operação destrutiva. Repita com --confirm para resetar os dados locais.' });
        process.exitCode = 1;
        return;
      }
      const db = openAppDatabase();
      try {
        resetDatabase(db);
        write({ ok: true, message: 'Dados locais resetados e banco re-migrado.' });
      } finally {
        db.close();
      }
    });

  program
    .command('campaigns:list')
    .description('Lista as campanhas.')
    .action(() => {
      const db = openAppDatabase();
      try {
        const campaigns = new CampaignRepo(db).list();
        write({ campaigns });
      } finally {
        db.close();
      }
    });

  program
    .command('candidates:list')
    .description('Lista candidatos de uma campanha.')
    .requiredOption('--campaign <name>', 'nome da campanha')
    .option('--summary', 'mostra apenas dados agregados, sem listar candidatos')
    .option('--account <username>', 'conta usada nas contagens de follow (padrão: a primeira)')
    .action((options: { campaign: string; summary?: boolean; account?: string }) => {
      const db = openAppDatabase();
      try {
        const campaign = new CampaignRepo(db).findByName(options.campaign);
        if (!campaign) {
          write({ error: `Campanha não encontrada: ${options.campaign}` });
          process.exitCode = 1;
          return;
        }
        if (options.summary) {
          const accounts = new LocalAccountRepo(db);
          const account = options.account
            ? accounts.findByUsername(options.account)
            : accounts.list()[0];
          if (!account) {
            write({ error: 'Nenhuma conta local. Crie com account:create.' });
            process.exitCode = 1;
            return;
          }
          write({
            campaign: campaign.name,
            account: account.username,
            summary: buildCampaignSummary(db, campaign.id, account.id),
          });
          return;
        }
        const candidates = new CampaignCandidateRepo(db).listByCampaign(campaign.id);
        write({ campaign: campaign.name, total: candidates.length, candidates });
      } finally {
        db.close();
      }
    });

  program
    .command('target:summary')
    .description('Resume um perfil-alvo agregando todas as campanhas locais relacionadas.')
    .requiredOption('--username <username>', 'username do perfil-alvo')
    .action((options: { username: string }) => {
      const db = openAppDatabase();
      try {
        const target = new ProfileRepo(db).findByUsername(options.username);
        if (!target) {
          write({ error: `Perfil-alvo não encontrado localmente: ${options.username}` });
          process.exitCode = 1;
          return;
        }
        write(buildTargetSummary(db, target));
      } finally {
        db.close();
      }
    });

  program
    .command('history')
    .description('Mostra o histórico local de um username.')
    .requiredOption('--username <username>', 'username do perfil')
    .action((options: { username: string }) => {
      const db = openAppDatabase();
      try {
        const profile = new ProfileRepo(db).findByUsername(options.username);
        if (!profile) {
          write({ error: `Perfil não encontrado localmente: ${options.username}` });
          process.exitCode = 1;
          return;
        }
        const cycles = new RelationshipRepo(db).listCyclesByProfileId(profile.id);
        const actions = new ActionAttemptRepo(db).listByProfileId(profile.id);
        write({ profile, cycles, actions });
      } finally {
        db.close();
      }
    });

  program
    .command('fixtures:seed')
    .description('Insere dados de exemplo para desenvolvimento (não usa Instagram).')
    .action(() => {
      const db = openAppDatabase();
      try {
        const accounts = new LocalAccountRepo(db);
        const profiles = new ProfileRepo(db);
        const campaigns = new CampaignRepo(db);
        const candidates = new CampaignCandidateRepo(db);
        const relationships = new RelationshipRepo(db);

        const account =
          accounts.findByUsername('minha_conta') ?? accounts.create({ username: 'minha_conta' });
        const target = profiles.upsert({
          username: 'perfil_alvo_financas',
          profileUrl: 'https://instagram.com/perfil_alvo_financas',
        });
        const campaign =
          campaigns.findByName('Financas Demo') ??
          campaigns.create({
            name: 'Financas Demo',
            targetProfileId: target.id,
            targetUrl: target.profileUrl ?? undefined,
            description: 'Campanha de exemplo (fixtures).',
          });

        const sampleUsernames = ['investidor_a', 'trader_b', 'renda_fixa_c'];
        const added = sampleUsernames.map((username) => {
          const profile = profiles.upsert({ username });
          return candidates.add({ campaignId: campaign.id, profileId: profile.id }).created;
        });

        const first = profiles.findByUsername('investidor_a');
        if (first) {
          const relationship = relationships.ensure(account.id, first.id);
          if (!relationships.getOpenCycle(relationship.id)) {
            relationships.createCycle({
              relationshipId: relationship.id,
              origin: 'TOOL_CLICK',
              campaignId: campaign.id,
              state: 'FOLLOWING',
            });
          }
        }

        write({
          ok: true,
          account: account.username,
          campaign: campaign.name,
          candidatesAdded: added.filter(Boolean).length,
          totalCandidates: candidates.countByCampaign(campaign.id),
        });
      } finally {
        db.close();
      }
    });

  program
    .command('account:create')
    .description('Registra uma conta local do Instagram (sem senha/token).')
    .requiredOption('--username <username>', 'username da conta local')
    .action((options: { username: string }) => {
      const db = openAppDatabase();
      try {
        const accounts = new LocalAccountRepo(db);
        const existing = accounts.findByUsername(options.username);
        const account = existing ?? accounts.create({ username: options.username });
        write({ ok: true, created: !existing, account });
      } finally {
        db.close();
      }
    });

  program
    .command('campaign:create')
    .description('Cria uma campanha com um perfil-alvo informado manualmente.')
    .requiredOption('--name <name>', 'nome da campanha')
    .requiredOption('--target <username>', 'username do perfil-alvo')
    .option('--url <url>', 'URL do perfil-alvo')
    .action((options: { name: string; target: string; url?: string }) => {
      const db = openAppDatabase();
      try {
        const campaigns = new CampaignRepo(db);
        if (campaigns.findByName(options.name)) {
          write({ error: `Campanha já existe: ${options.name}` });
          process.exitCode = 1;
          return;
        }
        const targetUsername = canonicalUsername(options.target);
        const targetUrl = options.url ?? `https://www.instagram.com/${targetUsername}/`;
        const target = new ProfileRepo(db).upsert({
          username: targetUsername,
          profileUrl: targetUrl,
        });
        const campaign = campaigns.create({
          name: options.name,
          targetProfileId: target.id,
          targetUrl,
        });
        write({ ok: true, campaign });
      } finally {
        db.close();
      }
    });

  program
    .command('plan-follow')
    .description('Prévia (dry-run) de follow, ordenada por engajamento. Nenhuma ação real.')
    .requiredOption('--campaign <name>', 'nome da campanha')
    .option('--account <username>', 'conta local (padrão: a primeira registrada)')
    .option('--limit <n>', 'limita a quantidade de candidatos propostos')
    .option('--only-unattempted', 'exclui candidatos com qualquer tentativa anterior de follow')
    .option('--export <format>', 'exporta a prévia: csv | json')
    .option('--dry-run', 'apenas prévia (sempre verdadeiro nesta fase)')
    .action(
      (options: {
        campaign: string;
        account?: string;
        limit?: string;
        onlyUnattempted?: boolean;
        export?: string;
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
            write({ error: 'Nenhuma conta local. Crie com account:create ou rode fixtures:seed.' });
            process.exitCode = 1;
            return;
          }
          const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
          const candidates = loadFollowCandidates(db, campaign.id, account.id);
          const preview = buildFollowPreview(candidates, {
            ...(limit ? { limit } : {}),
            ...(options.onlyUnattempted ? { onlyUnattempted: true } : {}),
          });

          if (options.export === 'csv') {
            process.stdout.write(`${followPreviewToCsv(preview)}\n`);
            return;
          }
          write({ campaign: campaign.name, account: account.username, dryRun: true, preview });
        } finally {
          db.close();
        }
      },
    );
}

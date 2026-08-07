import type { Command } from 'commander';
import { openAppDatabase } from '../../database/app-db.js';
import { RunRepo } from '../../database/repositories/runs.js';
import { ActionAttemptRepo } from '../../database/repositories/actions.js';
import { ProfileRepo } from '../../database/repositories/profiles.js';
import { formatRunReport, type RunReportItem } from '../format/run-report.js';
import { computeMetrics, formatMetrics } from '../../workflows/metrics.js';

function writeText(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function registerReportCommands(program: Command): void {
  program
    .command('runs:report')
    .description('Relatório human-readable consolidado de uma execução (padrão: a mais recente).')
    .option('--run <id>', 'id da execução')
    .action((options: { run?: string }) => {
      const db = openAppDatabase();
      try {
        const runs = new RunRepo(db);
        const run = options.run ? runs.get(options.run) : runs.list()[0];
        if (!run) {
          if (options.run) {
            writeText(`Execução não encontrada: ${options.run}`);
            process.exitCode = 1;
          } else {
            writeText('Nenhuma execução registrada ainda.');
          }
          return;
        }
        const profiles = new ProfileRepo(db);
        const items: RunReportItem[] = new ActionAttemptRepo(db).listByRunId(run.id).map((a) => ({
          username: profiles.findById(a.profileId)?.usernameCanonical ?? a.profileId,
          state: a.state,
          result: a.result,
          screenshotPath: a.screenshotPath,
        }));
        writeText(formatRunReport({ run, items }));
      } finally {
        db.close();
      }
    });

  program
    .command('metrics')
    .description('Métricas agregadas para o experimento de validação (somente leitura).')
    .action(() => {
      const db = openAppDatabase();
      try {
        writeText(formatMetrics(computeMetrics(db)));
      } finally {
        db.close();
      }
    });
}

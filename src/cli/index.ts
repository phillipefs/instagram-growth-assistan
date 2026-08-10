import { Command } from 'commander';
import { loadConfig } from '../config/schema.js';
import { resolveDataPaths } from '../config/paths.js';
import { logger } from '../observability/logger.js';
import { SafetyMonitor } from '../safety/safety-monitor.js';
import { registerDataCommands } from './commands/data-commands.js';
import { registerSessionCommands } from './commands/session-commands.js';
import { registerCollectCommands } from './commands/collect-commands.js';
import { registerPlanCommands } from './commands/plan-commands.js';
import { registerFollowCommands } from './commands/follow-commands.js';
import { registerLikeCommands } from './commands/like-commands.js';
import { registerReconcileCommands } from './commands/reconcile-commands.js';
import { registerUnfollowPlanCommands } from './commands/unfollow-plan-commands.js';
import { registerUnfollowCommands } from './commands/unfollow-commands.js';
import { registerReportCommands } from './commands/report-commands.js';
import { registerDebugCommands } from './commands/debug-commands.js';
import { registerFollowersCommands } from './commands/followers-commands.js';

/**
 * Ponto de entrada da CLI.
 *
 * Nesta fase o aplicativo é somente leitura: não abre o Instagram nem executa
 * qualquer clique. Os comandos servem para inspecionar a configuração e os
 * caminhos operacionais resolvidos.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('automation-seguidores')
    .description('Assistente local e supervisionado de campanhas no Instagram (modo somente leitura).')
    .version('0.1.0');

  program
    .command('config:show')
    .description('Mostra a configuração efetiva com os padrões seguros aplicados.')
    .action(() => {
      const config = loadConfig();
      logger.debug({ command: 'config:show' }, 'exibindo configuração efetiva');
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    });

  program
    .command('paths:show')
    .description('Mostra os caminhos de dados operacionais (fora do workspace/OneDrive).')
    .action(() => {
      const paths = resolveDataPaths();
      logger.debug({ command: 'paths:show' }, 'exibindo caminhos operacionais');
      process.stdout.write(`${JSON.stringify(paths, null, 2)}\n`);
    });

  program
    .command('safety:status')
    .description('Mostra o estado do monitor de segurança e as travas de configuração.')
    .action(() => {
      const config = loadConfig();
      const monitor = new SafetyMonitor();
      logger.debug({ command: 'safety:status' }, 'exibindo estado de segurança');
      const report = {
        state: monitor.getState(),
        safe: monitor.isSafe(),
        reason: monitor.reason() ?? null,
        config: {
          executionMode: config.execution.mode,
          automaticActionsEnabled: config.execution.automaticActionsEnabled,
          defaultRealActionLimit: config.execution.defaultRealActionLimit,
          automaticResume: config.safety.automaticResume,
          parallelAccounts: config.safety.parallelAccounts,
        },
        note: 'Nenhuma execução ativa. Diagnóstico detalhado por run virá nas fases seguintes.',
      };
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });

  registerDataCommands(program);
  registerSessionCommands(program);
  registerCollectCommands(program);
  registerPlanCommands(program);
  registerFollowCommands(program);
  registerLikeCommands(program);
  registerReconcileCommands(program);
  registerFollowersCommands(program);
  registerUnfollowPlanCommands(program);
  registerUnfollowCommands(program);
  registerReportCommands(program);
  registerDebugCommands(program);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'falha ao executar a CLI');
  process.exitCode = 1;
});

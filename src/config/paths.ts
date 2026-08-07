import os from 'node:os';
import path from 'node:path';

/**
 * Nome do diretório de dados operacionais desta ferramenta.
 */
export const APP_DIR_NAME = 'automation-seguidores';

/**
 * Resolve a raiz onde ficam banco, perfil do navegador e evidências.
 *
 * Decisão de segurança: por padrão os dados NUNCA ficam dentro do workspace,
 * que pode estar sincronizado pelo OneDrive. Ficam em %LOCALAPPDATA% (Windows)
 * ou no diretório home do usuário, com possibilidade de override explícito.
 */
export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AUTOMATION_SEGUIDORES_HOME?.trim();
  if (override && override.length > 0) {
    return path.resolve(override);
  }

  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData && localAppData.length > 0) {
    return path.join(localAppData, APP_DIR_NAME);
  }

  const xdgData = env.XDG_DATA_HOME?.trim();
  if (xdgData && xdgData.length > 0) {
    return path.join(xdgData, APP_DIR_NAME);
  }

  return path.join(os.homedir(), '.local', 'share', APP_DIR_NAME);
}

export interface DataPaths {
  readonly root: string;
  readonly database: string;
  readonly browserProfile: string;
  readonly evidence: string;
  readonly screenshots: string;
  readonly traces: string;
  readonly logs: string;
}

/**
 * Deriva todos os caminhos operacionais a partir da raiz resolvida.
 */
export function resolveDataPaths(env: NodeJS.ProcessEnv = process.env): DataPaths {
  const root = resolveDataRoot(env);
  const evidence = path.join(root, 'evidence');
  return {
    root,
    database: path.join(root, 'db', 'automation-seguidores.sqlite'),
    browserProfile: path.join(root, 'browser-profile'),
    evidence,
    screenshots: path.join(evidence, 'screenshots'),
    traces: path.join(evidence, 'traces'),
    logs: path.join(root, 'logs'),
  };
}

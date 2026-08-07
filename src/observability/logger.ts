import pino, { type Logger } from 'pino';

/**
 * Campos que nunca devem aparecer em claro nos logs.
 */
const REDACTED_PATHS = [
  'password',
  'senha',
  'token',
  'cookie',
  'cookies',
  '*.password',
  '*.senha',
  '*.token',
  '*.cookie',
];

export interface LoggerOptions {
  readonly level?: string;
  readonly pretty?: boolean;
}

/**
 * Cria um logger estruturado (JSON) com mascaramento de dados sensíveis.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? process.env.LOG_LEVEL ?? 'info';
  return pino({
    level,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    base: undefined,
    ...(options.pretty ? { transport: { target: 'pino-pretty' } } : {}),
  });
}

export const logger: Logger = createLogger();

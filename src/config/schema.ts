import { z } from 'zod';

/**
 * Modos de execução suportados.
 *
 * - `dry-run`: nenhuma ação real; apenas mostra o que seria feito.
 * - `manual`: abre a página e espera o usuário executar o clique.
 * - `confirm-each`: pede confirmação e executa exatamente uma ação por vez.
 * - `supervised-batch`: executa uma fatia de um plano imutável, com lista
 *   revisada, confirmação única para iniciar a fatia, limite positivo
 *   obrigatório, navegador visível e parada fechada em qualquer divergência.
 */
export const executionModeSchema = z.enum([
  'dry-run',
  'manual',
  'confirm-each',
  'supervised-batch',
]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const configSchema = z.object({
  execution: z
    .object({
      mode: executionModeSchema.default('dry-run'),
      visibleBrowser: z.boolean().default(true),
      confirmationRequired: z.boolean().default(true),
      automaticActionsEnabled: z.boolean().default(false),
      /** Teto operacional contra excesso acidental. Nunca é "limite seguro" da plataforma. */
      defaultRealActionLimit: z.number().int().min(0).default(0),
      /** Tamanho padrão de cada fatia de lote supervisionado. Zero exige valor explícito. */
      defaultBatchSliceSize: z.number().int().min(0).default(0),
      /**
       * Teto operacional de ações reais confirmadas por conta, por dia UTC, por
       * tipo de ação. Zero desliga o teto diário (o limite por invocação continua
       * valendo). Não é um "limite seguro" da plataforma nem imita comportamento.
       */
      dailyActionCap: z.number().int().min(0).default(0),
    })
    .prefault({}),
  safety: z
    .object({
      stopOnWarning: z.boolean().default(true),
      stopOnUnknownState: z.boolean().default(true),
      stopOnSessionChange: z.boolean().default(true),
      automaticRetryActions: z.boolean().default(false),
      automaticResume: z.boolean().default(false),
      parallelAccounts: z.boolean().default(false),
    })
    .prefault({}),
  follow: z
    .object({
      /**
       * Filtro de qualidade: pula um perfil quando ele tem MENOS de N seguidores.
       * Se a contagem não puder ser lida, o perfil vai para revisão sem clique.
       * Zero desliga o filtro. Pode ser sobrescrito por `--skip-inactive`.
       */
      skipInactiveBelow: z.number().int().min(0).default(0),
    })
    .prefault({}),
  unfollow: z
    .object({
      onlyToolRecordedFollows: z.boolean().default(true),
      preserveWhitelist: z.boolean().default(true),
      preserveProtected: z.boolean().default(true),
      // Decisão do usuário: não preservar follow-backs; a proteção é por origem.
      preserveFollowBacks: z.boolean().default(false),
      /** Validade, em dias, de uma observação de follow-back. */
      followBackValidityDays: z.number().int().min(1).default(7),
      requirePreview: z.boolean().default(true),
      requireConfirmation: z.boolean().default(true),
    })
    .prefault({}),
  like: z
    .object({
      /** Idade máxima, em dias, para uma publicação ser considerada "recente". */
      recentPostMaxAgeDays: z.number().int().min(1).default(30),
      maxLikesPerCandidatePerCampaign: z.number().int().min(0).max(1).default(1),
    })
    .prefault({}),
  /** Fuso usado para apresentar datas. O armazenamento é sempre em UTC. */
  timezone: z.string().min(1).default('America/Sao_Paulo'),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Valida e completa a configuração com padrões seguros.
 */
export function loadConfig(input: unknown = {}): AppConfig {
  return configSchema.parse(input ?? {});
}

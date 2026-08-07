# TODO.md

Itens reais pendentes, por fase. Marcar apenas o que existe de fato.

## Fase 01 — Inicialização (concluída)
- [x] Projeto Node + TypeScript estrito
- [x] ESLint, Prettier, Vitest, Playwright, Zod, pino
- [x] Estrutura de pastas
- [x] Config validada + resolução de caminhos fora do OneDrive
- [x] Contratos de estado do domínio
- [x] Documentos base
- [x] Testes unitários iniciais

## Fase 02 — Segurança e contratos
- [x] `SafetyMonitor` central com estados e transições
- [x] Estratégia de idempotency key (sem timestamp/username isolado)
- [x] Máquina de tentativa de ação (PREPARED → CONFIRMED/AMBIGUOUS/FAILED/SKIPPED)
- [x] Modelo de lease de concorrência (uma execução por conta)
- [x] Comando `safety:status` (somente leitura)

## Fase 03 — Banco de dados
- [x] Migrações versionadas
- [x] Tabelas: contas, perfis/aliases, campanhas, candidatos, ciclos de
      relacionamento, mídias, planos/itens, runs, tentativas, eventos, locks
- [x] Repositórios tipados e transações
- [x] Testes de migração, deduplicação, idempotência e transições
- [x] Comandos: `db:migrate`, `db:status`, `db:reset --confirm`,
      `campaigns:list`, `candidates:list`, `history`, `fixtures:seed`
- [ ] Repositórios de plans/runs (implementados nas fases correspondentes)

## Fase 04 — Sessão e login manual
- [x] BrowserSession (perfil persistente local, encerramento seguro)
- [x] Detecção de conta ativa e mudança de conta
- [x] Detector de sessão/segurança puro e testável
- [x] Adaptador de localizadores centralizado
- [x] Comandos: `session:open`, `session:check`, `session:clear --confirm`
- [x] Fixtures HTML + testes e2e (Playwright/Chromium)

## Fase 05 — Reconhecimento e engajamento
- [x] Domínio de fontes de descoberta e sinais de engajamento
- [x] Migração 002: `discovery_source` + tabela `candidate_signals`
- [x] Reconhecimento de perfil (detector puro + leitor + fixtures + e2e)
- [x] Comando `inspect-profile` (somente leitura)
- [x] Reconhecimento de publicação e extração de comentaristas/curtidores
- [x] Coleta engajada e dry-run (ingest idempotente + plan-follow)
- [x] Comandos `account:create`, `campaign:create`, `collect`, `plan-follow`
- [ ] Cursor de retomada persistente da coleta (com núcleo de execução)

## Fase 06 — Núcleo de execução
- [x] Plano imutável (`FROZEN`) + itens em snapshot + hash de critérios
- [x] Repositório de runs (ciclo de vida)
- [x] Guarda pré-ação pura (safety, conta, plano, relacionamento)
- [x] Motor de execução em lote idempotente (fecha em ambíguo/falha/limite)
- [x] Comandos `plan:create-follow`, `plans:list/show`, `runs:list/show`

## Fases seguintes
- [x] Follow supervisionado (dry-run/manual/confirm-each/supervised-batch)
- [x] Curtida de publicação recente (dry-run/manual/confirm-each)
- [ ] Reconciliação de follow-back
- [ ] Reconciliação de follow-back
- [ ] Planejamento e execução de unfollow
- [ ] Robustez, observabilidade e testes transversais
- [ ] Experimento de validação e handoff

## Débitos técnicos
- [ ] Avaliar ESLint com regras type-checked (recommendedTypeChecked)
- [ ] Decidir biblioteca SQLite definitiva (better-sqlite3 x node:sqlite)

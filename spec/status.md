# Status do Projeto — automation-seguidores

Documento vivo com o que já está **finalizado e verificado**. Atualizado ao fim
de cada fase. Última atualização: 2026-08-07.

> Legenda: ✅ concluído e verificado · 🟡 parcial · ⬜ não iniciado

## Visão geral

Assistente **local** e **supervisionado** de campanhas no Instagram para o nicho
do mercado financeiro. A estratégia prioriza **pessoas engajadas** (que
comentaram ou curtiram publicações recentes do perfil-alvo) em vez da lista bruta
de seguidores. Toda ação real exige modo explícito, limite positivo e
confirmação; o padrão é `dry-run` e limite zero.

As especificações originais estão em [`spec/`](.) (arquivos `00`–`13`). Este
documento registra o que foi implementado em relação a elas.

## Resumo por fase

| Spec | Tema | Status |
|---|---|---|
| `01_inicializacao_e_regras.md` | Inicialização, tooling, documentos base | ✅ |
| `02_modelo_dados_e_historico.md` | Modelo de dados, migrações, máquinas de estado | ✅ |
| `03_sessao_navegador_e_login.md` | Sessão Playwright visível, login manual | ✅ |
| `04_exploracao_somente_leitura.md` | Reconhecimento somente leitura, `inspect-profile` | ✅ |
| `05_coleta_campanhas_e_dry_run.md` | Coleta engajada + `plan-follow --dry-run` | ✅ |
| Núcleo de execução (plano imutável + run + guarda pré-ação) | — | ✅ |
| `06_follow_supervisionado.md` | Follow supervisionado (4 modos) | ✅ |
| `07_curtida_publicacao_supervisionada.md` | Curtida de publicação (3 modos) | ✅ |
| Reconciliação de follow-back (somente leitura) | — | ✅ |
| `08_planejador_unfollow.md` | Planejador de unfollow por coorte | ✅ |
| `09_unfollow_supervisionado.md` | Unfollow supervisionado (4 modos) | ✅ |
| Gravação de runs + progresso de plano + teto diário | — | ✅ |
| Relatório (`runs:report`) + métricas (`metrics`) | — | ✅ |
| Melhorias de campo (filtros, progresso, follow+like) | — | ✅ |
| `10_seguranca_e_circuit_breaker.md` | `SafetyMonitor` central (núcleo) | ✅ (núcleo) / 🟡 transversal |
| `11_recuperacao_logs_e_testes.md` | Idempotência, lease, logger, runs, evidência | ✅ |
| `12_experimento_de_validacao.md` | Follow/curtida validados ao vivo; unfollow real pendente | 🟡 |
| `13_revisao_final_e_entrega.md` | Handoff + aceite de risco (dado pelo usuário) | ✅ |

> Ordem de implementação foi **reordenada** em relação à numeração: segurança,
> idempotência e recuperação vêm **antes** de qualquer ação real (ver `ADR-0003`).

## Finalizado em detalhe

### Fase 01 — Inicialização ✅
- Node.js + TypeScript estrito, ESLint, Prettier, Vitest, Playwright, Zod, pino.
- Scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`.
- Documentos base: `AGENTS.md`, `SPEC.md`, `ARCHITECTURE.md`, `DECISIONS.md`,
  `TODO.md`, `README.md`.
- Config validada por Zod com padrões seguros (`src/config/schema.ts`).
- Dados operacionais resolvidos **fora do workspace/OneDrive**
  (`src/config/paths.ts` → `%LOCALAPPDATA%/automation-seguidores`).
- Logger estruturado com mascaramento (`src/observability/logger.ts`).

### Fase 02 — Segurança e contratos ✅
- `SafetyMonitor` central sem retomada automática (`src/safety/safety-monitor.ts`).
- Idempotência determinística sha256 (`src/domain/idempotency.ts`).
- Máquina de tentativa de ação `PREPARED → CONFIRMED/AMBIGUOUS/FAILED/SKIPPED`
  (`src/domain/action-attempt.ts`).
- Lease de concorrência com heartbeat e recuperação de lease órfão
  (`src/safety/lease.ts`).
- Máquinas de estado separadas (`src/domain/states.ts`).

### Fase 03 — Banco de dados ✅
- SQLite (better-sqlite3) com WAL e `foreign_keys` (`src/database/connection.ts`).
- Migrações versionadas e transacionais (`src/database/migrator.ts`).
- Migração `001` (schema completo) e `002` (fonte de descoberta + sinais).
- Repositórios tipados: contas, perfis/aliases, campanhas, candidatos, ciclos de
  relacionamento, sinais de engajamento, tentativas de ação.
- Datas em UTC; `idempotency_key` com `UNIQUE`; deduplicação por chaves naturais.

### Fase 04 — Sessão e reconhecimento ✅
- `BrowserSession` com contexto persistente **visível**, sem preencher
  credenciais (`src/browser/browser-session.ts`).
- Detector de sessão com falha fechada (`src/browser/session-detector.ts`).
- Guarda de conta ativa (`src/browser/account-guard.ts`).
- Reconhecimento de perfil: público/privado/inexistente/indisponível/desconhecido
  e estado do relacionamento (`src/browser/profile-detector.ts`).
- Localizadores centralizados (`src/instagram/*-locators.ts`).

### Fase 05 — Coleta engajada e prévia ✅
- Descoberta priorizada por engajamento: comentaristas > curtidores (best-effort)
  > seguidores (`src/domain/discovery.ts`).
- Leitura de publicações, comentaristas e curtidores (`src/browser/read-posts.ts`).
- Ingestão idempotente com deduplicação e registro de sinais
  (`src/workflows/collect.ts`).
- Coleta via navegador com paradas de segurança (`src/workflows/collect-browser.ts`).
- Prévia `plan-follow` dry-run ordenada por engajamento, com exclusões e export
  CSV/JSON (`src/workflows/plan-follow.ts`).

### Núcleo de execução ✅
- Hash estável de critérios/config (`src/domain/hash.ts`).
- Plano imutável `DRAFT → FROZEN` com itens em snapshot e `criteria_hash`
  (`src/database/repositories/plans.ts`); `freezeFollowPlan` congela a partir dos
  candidatos aprovados.
- Repositório de runs com ciclo de vida (`src/database/repositories/runs.ts`).
- Guarda pré-ação pura revalidando segurança, conta, plano e relacionamento,
  com falha fechada (`src/workflows/pre-action.ts`).
- Motor de execução em lote idempotente que fecha em ambíguo/falha/limite
  (`src/workflows/execution.ts`).

### Fase 06 — Follow supervisionado ✅
- Clique único de seguir com confirmação visual (`src/browser/follow-action.ts`).
- Interpretação pura do resultado (`src/workflows/follow-result.ts`).
- Workflow `runFollow` nos quatro modos, ligado ao motor e à guarda, com
  evidência por screenshot e registro do ciclo `TOOL_CLICK`
  (`src/workflows/follow.ts`).
- Comando `follow` com driver Playwright e confirmação via stdin; limite real
  padrão zero e plano congelado obrigatório fora do dry-run.

### Fase 07 — Curtida de publicação ✅
- Seleção pura da publicação recente, excluindo fixados antigos e respeitando a
  idade máxima (`src/domain/recent-post.js`).
- Ação de curtir com confirmação visual (`src/browser/like-action.js`).
- Workflow `runLike` nos modos `dry-run`/`manual`/`confirm-each` (sem lote), uma
  curtida por candidato por campanha, com registro de mídia (`src/workflows/like.js`).
- Comando `like-post`.

### Reconciliação de follow-back ✅
- Frescor/elegibilidade puros (`src/domain/follow-back.js`): só `NO` fresco é
  elegível ao unfollow; `YES`/`UNKNOWN`/vencido falham fechado.
- Detector do selo "segue você" (`src/browser/followback-detector.js`,
  `src/browser/read-followback.js`).
- Workflow `runReconcile` somente leitura que salva `YES`/`NO`/`UNKNOWN` no ciclo
  (`src/workflows/reconcile-followback.js`) e comando `reconcile-followback`.

### Fase 08 — Planejador de unfollow ✅
- Janelas de coorte puras (`src/domain/cohort.js`): janela móvel, intervalo de
  datas e mês de calendário (distintos entre si).
- Regra base + contagem de exclusões e plano imutável `UNFOLLOW`
  (`src/workflows/plan-unfollow.js`).
- Comandos `plan-unfollow` (prévia/CSV) e `plan:create-unfollow`.

### Fase 09 — Unfollow supervisionado ✅
- Ação de deixar de seguir com confirmação visual e distinção entre `UNFOLLOW` e
  `CANCEL_FOLLOW_REQUEST` (`src/browser/unfollow-action.js`,
  `src/workflows/unfollow-result.js`).
- Workflow `runUnfollow` nos quatro modos, revalidando por item origem
  (`TOOL_CLICK`), whitelist, proteção e follow-back; sincroniza sem clique quando
  o usuário já deixou de seguir (`src/workflows/unfollow.js`).
- Comando `unfollow` (plano `UNFOLLOW` congelado obrigatório; limite real zero).
- Validado ponta a ponta no Instagram real (menu "Following" → diálogo → "Unfollow").

### Robustez transversal — runs, progresso e teto diário ✅
- Toda ação real (`follow`/`like-post`/`unfollow`) registra uma **run**
  (`RunRepo`): `CREATED → RUNNING → COMPLETED/STOPPED/FAILED`, com contadores e
  motivo de parada; o `runId` liga cada `action_attempt`.
- `plans:show` mostra o **progresso** do plano (`PlanRepo.progress`): total,
  pendentes, confirmados, pulados, ambíguos, falhos e `percentDone`.
- **Teto operacional diário** (`execution.dailyActionCap`, `src/workflows/daily-cap.js`):
  limita ações reais confirmadas/ambíguas por conta, por dia UTC, por tipo. Zero
  desliga o teto; nunca é um "limite seguro" da plataforma. `warm-up` (rampa
  gradual) **não** é implementado por ser contorno de limites da plataforma.
- **Evidência em falha/ambiguidade**: follow, curtida e unfollow capturam
  screenshot e gravam o caminho em `action_attempts.screenshot_path` não só no
  sucesso, mas também quando o resultado é ambíguo ou falha — para revisão manual.
- **Skip auditável de follow ambíguo**: `follow:skip-ambiguous` registra uma
  reconciliação append-only, exige confirmação explícita, não repete o clique e
  libera os demais itens do mesmo plano.
- **Relatório e métricas**: `runs:report` gera um relatório human-readable
  consolidado de uma execução (cabeçalho, duração, contadores e itens com
  evidência); `metrics` agrega cobertura de coleta, desfecho das ações, ciclos e
  follow-back para o experimento de validação (`src/workflows/metrics.js`,
  `src/cli/format/run-report.js`).

### Melhorias de campo ✅
Refinamentos pedidos durante os testes reais:

- **Progresso em tempo real** no lote (follow/unfollow): uma linha por item no
  `stderr` (`[12/100] @fulano — confirmado ✓`), o JSON final fica limpo no stdout.
- **`--skip-inactive <n>`** no follow: pula perfis com **menos de N seguidores E
  menos de N seguindo** (contas vazias/bot). Lê os contadores do cabeçalho do
  perfil (`src/domain/profile-counts.js`); validado ao vivo. `inspect-profile`
  também expõe `followersCount`/`followingCount`.
- **`--like`** no follow: ao seguir um perfil **aberto**, curte 1 publicação
  recente na mesma passada (1 like por candidato por campanha, idempotente);
  perfil fechado vira solicitação e não é curtido. Lê o grid da própria página do
  perfil, sem recarregar (otimização).
- **`--skip-posts <n>`** no collect: pula os primeiros N posts do grid (fixados),
  para re-execuções pegarem publicações mais novas. O grid é rolado
  progressivamente até obter `--posts + --skip-posts` itens ou parar de crescer.
- **`--comments-per-post <n>`** no collect: substitui o teto padrão de 80
  comentaristas por publicação e aumenta proporcionalmente as rodadas técnicas
  de carregamento (máximo 200), sempre respeitando o `--limit` global.
- **`--only-unattempted`** em `plan-follow` e `plan:create-follow`: seleciona
  somente candidatos sem qualquer tentativa anterior de follow para a conta,
  incluindo a exclusão de itens pulados, ambíguos ou falhos.
- **`metrics` enriquecido**: follows abertos **por estado** (seguindo vs
  solicitação) e **por campanha**.

## Comandos disponíveis

O padrão de todo comando é somente leitura ou `dry-run`. Follow, curtida e
unfollow só executam ações reais com modo explícito, plano congelado (quando
aplicável), limite positivo e confirmação; o teto diário opcional limita o total
por conta/dia.

```text
config:show           # configuração efetiva (padrões seguros)
paths:show            # caminhos de dados (fora do OneDrive)
safety:status         # estado do SafetyMonitor e travas
db:migrate            # cria/migra o banco
db:status             # estado das migrações
db:reset --confirm    # reseta dados locais (destrutivo, exige confirmação)
account:create        # registra conta local (sem senha/token)
campaign:create       # cria campanha com perfil-alvo manual
campaigns:list        # lista campanhas
candidates:list       # lista candidatos; --summary mostra somente agregados
history               # histórico local de um username
fixtures:seed         # dados de exemplo (sem Instagram)
session:open          # abre navegador visível para login manual
session:check         # verifica a sessão (somente leitura)
session:clear --confirm  # apaga o perfil local do navegador
inspect-profile --url    # reconhece um perfil (somente leitura)
collect               # coleta candidatos engajados (somente leitura) [--skip-posts]
plan-follow           # prévia dry-run ordenada por engajamento
plan:create-follow    # congela plano de follow [--only-unattempted]
plans:list            # lista planos
plans:show --plan     # mostra um plano e seus itens (com progresso)
runs:list             # lista execuções
runs:show --run       # mostra uma execução
runs:report [--run]   # relatório human-readable de uma execução (padrão: a mais recente)
metrics               # métricas agregadas (por estado e por campanha; somente leitura)
follow                # follow supervisionado (dry-run padrão) [--skip-inactive --like]
follow:skip-ambiguous # pula explicitamente um follow ambíguo sem repetir o clique
like-post             # curtida supervisionada de publicação recente
reconcile-followback  # observa quem seguiu de volta (somente leitura)
plan-unfollow         # prévia dry-run de unfollow por coorte [--campaign]
plan:create-unfollow  # congela um plano de unfollow imutável
unfollow              # unfollow supervisionado (dry-run padrão; real exige plano)
```

## Modelo de dados (migrações 001–003)

Tabelas: `local_accounts`, `profiles`, `profile_aliases`, `campaigns`,
`campaign_candidates` (com `discovery_source`), `relationships`,
`relationship_cycles`, `candidate_signals`, `media`, `plans`, `plan_items`,
`runs`, `action_attempts`, `action_reconciliations`, `safety_events`, `leases`,
`schema_migrations`.

## Decisões-chave

- **ADR-0003** — Segurança/idempotência/recuperação antes de qualquer ação real.
- **ADR-0004** — Dados operacionais fora do workspace (OneDrive).
- **ADR-0006** — Proveniência do relacionamento; só `TOOL_CLICK` é elegível ao
  unfollow automático.
- **ADR-0007** — Follow-backs preservados por padrão (revisado por ADR-0010).
- **ADR-0008** — `supervised-batch` é supervisionado, não autônomo.
- **ADR-0009** — Descoberta priorizada por engajamento (comentaristas primeiro).
- **ADR-0010** — Não preservar follow-backs: todo follow `TOOL_CLICK` é elegível;
  a proteção é só por origem, whitelist e perfis protegidos.

Detalhes em [`../DECISIONS.md`](../DECISIONS.md).

## Verificação (última execução)

```text
typecheck   ok
lint        ok
test        196 passed (unit + integração, 37 arquivos)
test:e2e    23 passed (sessão, perfil, publicações, follow, curtida, follow-back, unfollow — Chromium real)
build       ok
```

Testes usam apenas fixtures locais; nenhuma conta real é acessada.

## Ainda não implementado (próximas fases)

- 🟡 **Experimento de validação em conta própria** (fase 12): follow, curtida e
  coleta **validados ao vivo** em campanhas reais (múltiplas campanhas, centenas
  de follows e curtidas). Falta apenas testar o **unfollow real** ao vivo.
- ✅ **Aceite de risco** (fase 13): dado pelo usuário em 2026-08-07.

## Handoff — checklist operacional (fase 13)

- [x] Padrão é `dry-run` e limite real 0; ação real exige modo explícito, plano
  congelado (follow/unfollow), limite positivo e confirmação.
- [x] Teto operacional diário opcional (`execution.dailyActionCap`); sem `warm-up`.
- [x] Falha fechada: sem retomada automática, sem contas paralelas, sem repetição
  de ação não confirmada.
- [x] Sem mecanismos de evasão (stealth, proxy, spoofing de fingerprint, CAPTCHA
  solver) — verificado por busca no código.
- [x] Dados operacionais (perfil do navegador, banco, evidências) fora do
  workspace/OneDrive (`%LOCALAPPDATA%/automation-seguidores`).
- [x] Só ciclos `TOOL_CLICK` são elegíveis ao unfollow; whitelist e protegidos
  nunca entram.
- [x] Evidência (screenshot) em sucesso, ambiguidade e falha.
- [x] Aceite explícito de risco do usuário antes de ampliar tetos operacionais
  (dado em 2026-08-07).

## Como começar

```bash
npm install
npx playwright install chromium
npm run dev -- config:show
npm run dev -- fixtures:seed
npm run dev -- plan-follow --campaign "Financas Demo"
```

## Aviso

A automação por interface está sujeita a mudanças de layout e às regras da
plataforma. Limites configuráveis evitam excesso acidental, mas não garantem
segurança perante o Instagram. Use apenas em contas próprias ou autorizadas.

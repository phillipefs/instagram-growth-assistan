# DECISIONS.md

Registro de decisões (ADR resumido). Mais recente no topo.

## ADR-0010 — Follow-backs não são preservados por padrão (revisa ADR-0007)
Decisão do usuário: todo follow feito pela ferramenta (`origin = TOOL_CLICK`)
pode ser removido no unfollow, independentemente de ter seguido de volta. A
proteção relevante é por **origem**: contas seguidas manualmente (fora da
ferramenta), whitelist e protegidas nunca entram. `preserveFollowBacks = false`
por padrão; pode ser reativado por configuração. Consequência: a reconciliação
de follow-back deixa de ser necessária para o unfollow — e, nesta versão do
Instagram web, o selo "segue você" não é exibido no perfil de quem você já
segue, o que tornaria a detecção não confiável de qualquer modo.

## ADR-0009 — Descoberta priorizada por engajamento
Em vez de coletar a lista bruta de seguidores (muitas contas inativas), a
descoberta prioriza pessoas engajadas nas publicações recentes do perfil-alvo:
`RECENT_POST_COMMENTERS` > `RECENT_POST_LIKERS` > `FOLLOWERS` > `MANUAL_IMPORT`.
Sinais de engajamento (`COMMENT`, `LIKE`, `FOLLOWS_TARGET`) são registrados por
candidato e usados para ranquear. Ressalva de plataforma: a lista de curtidores
costuma ser ocultada/limitada pelo Instagram; quando indisponível, é tratada
como best-effort (`NEEDS_REVIEW`), e comentaristas são a fonte principal.

## ADR-0008 — supervised-batch é supervisionado, não autônomo
O produto pretendido inclui operação "em massa". Ela é implementada como
`supervised-batch`: plano imutável, lista revisada, confirmação única por fatia,
`--limit` positivo obrigatório e revalidação por item. Qualquer ambiguidade
interrompe o lote. Execução autônoma sem acompanhamento permanece fora do escopo.

## ADR-0007 — Follow-backs preservados por padrão
No planejamento de unfollow, `preserveFollowBacks = true` por padrão. Apenas
`follow_back = NO` é elegível; `YES` e `UNKNOWN` falham fechado.

## ADR-0006 — Proveniência do relacionamento
`origin ∈ {TOOL_CLICK, USER_CLICK_OBSERVED, IMPORTED, PREEXISTING}`. Só
`TOOL_CLICK` é elegível ao unfollow automático. Ações manuais observadas nunca
são marcadas como ações da ferramenta.

## ADR-0005 — Máquinas de estado separadas
Campanha, relacionamento, ação, plano, run e segurança têm ciclos de vida
próprios, evitando uma única máquina de candidato sobrecarregada.

## ADR-0004 — Dados operacionais fora do workspace
Banco, perfil do navegador e evidências ficam em `%LOCALAPPDATA%`, não em `data/`
dentro do repositório, para não sincronizar dados sensíveis pelo OneDrive.

## ADR-0003 — Segurança e recuperação antes das ações reais
O núcleo do SafetyMonitor, idempotência e recuperação são implementados antes do
primeiro clique real, alterando a ordem original dos prompts.

## ADR-0002 — Perfis-alvo informados manualmente
No MVP, os perfis do nicho são fornecidos por username/URL. Descoberta automática
está fora do escopo.

## ADR-0001 — Stack base
Node.js + TypeScript estrito, Playwright (navegador visível), SQLite local, Zod
para configuração, pino para logs, Vitest para testes unitários/integração,
Playwright Test para e2e. Padrões seguros: `dry-run` e limite zero.

# SPEC.md — Especificação do MVP

## Objetivo

Aplicativo local e supervisionado para operar campanhas no Instagram a partir de
perfis-alvo do nicho financeiro: coletar seguidores, seguir candidatos, curtir no
máximo uma publicação recente por candidato e, mais tarde, deixar de seguir
coortes por período/campanha, sempre com histórico local e parada fechada.

O produto é um **assistente de lote supervisionado**, não um robô autônomo.

## Funções do MVP

1. **Coleta** — a partir de um perfil-alvo informado manualmente, descobrir
   candidatos priorizando engajamento: comentaristas de publicações recentes,
   depois curtidores (best-effort), depois a lista de seguidores. Registrar a
   fonte de descoberta e os sinais de engajamento por candidato.
2. **Campanha** — organizar candidatos, filtros e aprovação/rejeição manual.
3. **Follow** — seguir candidatos aprovados nos modos suportados.
4. **Curtida de publicação** — opcionalmente curtir uma publicação recente do
   candidato (nunca comentários, nunca mensagens diretas).
5. **Unfollow** — planejar e executar unfollow de coortes com histórico local.

## Modos de execução

- `dry-run` (padrão) — nenhuma ação real; apenas mostra o que seria feito.
- `manual` — abre a página e espera o usuário executar o clique.
- `confirm-each` — pede confirmação e executa exatamente uma ação por vez.
- `supervised-batch` — executa uma fatia de um plano imutável, com lista revisada,
  confirmação única para iniciar a fatia, `--limit` positivo obrigatório,
  navegador visível, revalidação por item e parada fechada em qualquer
  divergência. **Não** é execução autônoma: cada item passa pelas mesmas
  verificações do modo individual e qualquer resultado ambíguo interrompe o lote.

## Máquinas de estado (separadas)

- **Candidato de campanha:** `DISCOVERED → FILTERED → APPROVED | REJECTED |
  SKIPPED | NEEDS_REVIEW`.
- **Relacionamento:** `NOT_FOLLOWING → FOLLOW_REQUESTED → FOLLOWING → UNFOLLOWED`.
- **Origem do relacionamento:** `TOOL_CLICK | USER_CLICK_OBSERVED | IMPORTED |
  PREEXISTING`.
- **Follow-back:** `UNKNOWN | YES | NO`.
- **Tentativa de ação:** `PREPARED → PENDING → CONFIRMED | AMBIGUOUS | FAILED |
  SKIPPED`.
- **Plano:** `DRAFT → FROZEN → INVALIDATED | COMPLETED`.
- **Execução (run):** `CREATED → RUNNING → PAUSED | STOPPED | COMPLETED | FAILED`.
- **Segurança:** `SAFE | PAUSED | SUSPENDED | NEEDS_MANUAL_REVIEW |
  SESSION_EXPIRED | ACCOUNT_CHANGED | CAPTCHA_DETECTED | CHALLENGE_DETECTED |
  WARNING_DETECTED | UNKNOWN_INTERFACE`.

## Regra de elegibilidade de unfollow

```text
origin = TOOL_CLICK
AND followed_at IS NOT NULL
AND unfollowed_at IS NULL
AND whitelisted = false
AND protected = false
AND (preserveFollowBacks = false OR (follow_back = NO AND observation_is_fresh))
```

Com `--preserve-follow-backs`, `YES`, `UNKNOWN` e observações vencidas falham
fechado e não entram no plano. A política é congelada com o plano. O planejamento
exige um snapshot completo e recente produzido por `followers:sync`; uma coleta
incompleta nunca substitui o último snapshot válido.

Com `--only-unattempted`, qualquer perfil que já possua uma tentativa local de
`UNFOLLOW` é excluído. Na execução, ciclos `FOLLOWING` usam preferencialmente a
busca exata da janela “Seguindo”; `FOLLOW_REQUESTED`, ausência na lista ou
interface ambígua usam a página individual, sem inferir sucesso pela ausência.

## Critérios de aceite (Fase 01)

- `npm run lint`, `npm run typecheck` e `npm test` passam.
- O modo padrão é `dry-run` e o limite real padrão é zero.
- Nenhum código abre o Instagram ou executa cliques.
- Dados operacionais resolvem para fora do workspace.
- Documentos base criados e coerentes entre si.

## Casos de erro (princípios)

- Estado desconhecido → não clicar; classificar como `UNKNOWN`/`NEEDS_REVIEW`.
- Resultado ambíguo após ação → `AMBIGUOUS`, sem repetição automática.
- Divergência entre plano, banco e página → `NEEDS_REVIEW` e parada.
- Erro repetido → parada imediata.

## Fora do escopo

- Execução autônoma sem supervisão.
- Descoberta automática de perfis-alvo.
- Curtida de comentários ou de mensagens diretas.
- Proxies, stealth, fingerprint spoofing, CAPTCHA solver.
- Múltiplas contas em paralelo.
- Painel SaaS, pagamentos ou múltiplos clientes nesta validação.

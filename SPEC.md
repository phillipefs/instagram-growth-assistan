# SPEC.md — Especificação do MVP

## Objetivo

Aplicativo local e supervisionado para operar campanhas no Instagram a partir de
perfis-alvo do nicho financeiro: coletar candidatos engajados, seguir candidatos,
curtir no máximo uma publicação recente por candidato e deixar de seguir
coortes por período/campanha, sempre com histórico local e parada fechada.

O produto é um **assistente de lote supervisionado**, não um robô autônomo.

## Funções do MVP

1. **Coleta** — a partir de um perfil-alvo informado manualmente, descobrir
   candidatos priorizando comentaristas de publicações recentes e, quando a
   interface disponibiliza a lista, curtidores (best-effort). Registrar a fonte
   de descoberta e os sinais de engajamento por candidato.
2. **Campanha** — organizar candidatos, fontes, sinais e resumos por campanha e
   perfil-alvo.
3. **Follow** — seguir candidatos elegíveis a partir de planos imutáveis nos
   modos suportados.
4. **Curtida de publicação** — opcionalmente curtir uma publicação recente do
   candidato (nunca comentários, nunca mensagens diretas).
5. **Unfollow** — planejar e executar unfollow de coortes com histórico local.
6. **Medição** — sincronizar snapshots completos de seguidores e apresentar
   conversão por campanha e consolidada, preservando cobertura e proveniência.

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

Com `--no-follow-back-after N`, o planejamento combina três condições: o follow
ou a solicitação tem pelo menos N dias, o estado observado é `NO`, e a observação
foi feita somente depois de completar esse prazo. O parâmetro ativa a preservação
de follow-backs e exige snapshot completo recente. A idade é calculada por ciclo,
não pela data de criação da campanha.

## Critérios de aceite atuais

- `npm run lint`, `npm run typecheck` e `npm test` passam.
- O modo padrão é `dry-run` e o limite real padrão é zero.
- O navegador é sempre visível e o login é manual.
- Ações reais exigem modo explícito, limite positivo e confirmação; follow e
  unfollow também exigem plano congelado.
- Nenhuma ação ambígua é repetida automaticamente.
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

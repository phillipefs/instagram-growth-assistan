# Prompt 08 — Planejador de unfollow por período e campanha

Continue o projeto existente. Nesta fase, implemente somente o planejamento e a prévia do unfollow. Não execute cliques reais ainda.

O sistema deve selecionar apenas relacionamentos com histórico local comprovado.

Regra padrão obrigatória:

```text
followed_by_tool = true
AND followed_at IS NOT NULL
AND unfollowed_at IS NULL
AND whitelisted = false
AND protected = false
```

Implemente filtros combináveis:

- seguidos nos últimos X dias: `--followed-within X`;
- seguidos há mais de X dias: `--older-than X`;
- seguidos entre datas: `--from YYYY-MM-DD --to YYYY-MM-DD`;
- mês de calendário: `--calendar-month YYYY-MM`;
- campanha: `--campaign NOME`;
- perfil-alvo de origem;
- conta local do Instagram;
- somente quem não segue de volta: `--exclude-followers`;
- limite: `--limit N`;
- whitelist e protegidos sempre excluídos por padrão.

Diferencie claramente:

- “últimos 30 dias” como janela móvel;
- “mês anterior” ou `YYYY-MM` como mês de calendário.

Implemente comandos equivalentes a:

```bash
npm run dev -- plan-unfollow --older-than 15 --dry-run
npm run dev -- plan-unfollow --followed-within 7 --dry-run
npm run dev -- plan-unfollow --from 2026-07-01 --to 2026-07-31 --dry-run
npm run dev -- plan-unfollow --calendar-month 2026-07 --dry-run
npm run dev -- plan-unfollow --campaign "nome" --exclude-followers --limit 10 --dry-run
```

A prévia deve mostrar:

- total encontrado;
- excluídos por whitelist;
- excluídos por proteção;
- excluídos por falta de histórico confiável;
- excluídos por follow-back, quando solicitado;
- já não elegíveis;
- total final;
- usernames, data do follow, campanha, origem e motivo de elegibilidade.

Permita:

- exportar a fila em CSV e JSON;
- proteger um candidato diretamente da prévia;
- remover manualmente um candidato da fila;
- salvar a fila como um plano imutável com identificador próprio;
- invalidar o plano quando os critérios mudarem.

Crie testes extensivos garantindo que contas antigas anteriores à ferramenta, contas sem data, whitelist, protegidas e já removidas nunca sejam selecionadas incorretamente.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

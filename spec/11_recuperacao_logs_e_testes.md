# Prompt 11 — Recuperação, observabilidade e testes de robustez

Continue o projeto existente. Faça a aplicação sobreviver a interrupções sem duplicar ações.

Implemente:

- persistência do progresso de cada execução;
- retomada explícita, nunca automática após alerta;
- bloqueio para impedir duas execuções simultâneas na mesma conta;
- transações ao iniciar e concluir ações;
- idempotency keys consistentes;
- estados `PENDING`, `CONFIRMED`, `AMBIGUOUS` e `FAILED` para ações;
- reconciliação somente leitura após reinício;
- screenshots em falhas;
- Playwright traces em workflows habilitados;
- logs JSON estruturados;
- relatório humano ao final de cada execução;
- mascaramento de informações sensíveis nos logs.

Crie comandos equivalentes a:

```bash
npm run dev -- runs:list
npm run dev -- runs:show RUN_ID
npm run dev -- runs:resume RUN_ID --dry-run
npm run dev -- reconcile --run RUN_ID
npm run dev -- safety:status
```

A retomada deve:

- revalidar sessão e conta;
- revalidar banco e página;
- nunca repetir ação `CONFIRMED`;
- nunca repetir ação `AMBIGUOUS` automaticamente;
- exigir revisão manual quando houver dúvida.

Amplie os testes:

- unitários para regras de domínio;
- integração para banco e transações;
- e2e contra fixtures locais;
- testes de interrupção antes e depois do clique simulado;
- testes de reinício;
- testes de concorrência;
- testes de inconsistência entre página e banco;
- testes de falha fechada.

Crie um `TESTING.md` explicando como executar testes sem usar contas reais.

Ao terminar, execute lint, typecheck, testes unitários e e2e, atualize a documentação e não avance para outra fase.

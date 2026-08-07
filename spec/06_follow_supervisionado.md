# Prompt 06 — Follow supervisionado com confirmação individual

Continue o projeto existente. Leia o `AGENTS.md` e mantenha o modo padrão como `dry-run`.

Implemente o primeiro workflow que pode alterar o estado no Instagram: follow supervisionado e individual.

Não implemente execução em massa autônoma.

Crie modos:

- `dry-run`: apenas mostra a ação;
- `manual`: abre o perfil e espera o usuário executar o clique;
- `confirm-each`: pede confirmação explícita e executa uma única ação;
- não criar modo autônomo nesta fase.

Fluxo obrigatório para `confirm-each`:

1. verificar sessão e conta ativa;
2. carregar um candidato aprovado;
3. abrir o perfil correto;
4. confirmar username e URL;
5. detectar o estado atual;
6. verificar circuit breaker;
7. mostrar campanha, origem e ação proposta;
8. pedir confirmação explícita;
9. executar no máximo um clique de follow;
10. confirmar visualmente a mudança de estado;
11. registrar ação, `followed_at`, origem e evidência;
12. retornar ao estado de espera.

Regras:

- não clicar quando o estado for desconhecido;
- não repetir automaticamente quando não houver confirmação visual;
- marcar como `NEEDS_REVIEW` em resultado ambíguo;
- usar idempotency key;
- não seguir conta já seguida;
- distinguir, quando possível, `FOLLOWED` de `FOLLOW_REQUESTED`;
- não continuar automaticamente após um erro;
- limite padrão de ações reais deve ser zero até o usuário fornecer explicitamente um limite positivo;
- toda execução real deve mostrar a lista antes de começar.

Crie comandos equivalentes a:

```bash
npm run dev -- follow --campaign "nome" --dry-run
npm run dev -- follow --campaign "nome" --mode manual --limit 1
npm run dev -- follow --campaign "nome" --mode confirm-each --limit 1
```

Implemente testes completos em páginas simuladas. Em ambiente real, mantenha o fluxo supervisionado e limitado a contas de teste próprias ou autorizadas durante a validação.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

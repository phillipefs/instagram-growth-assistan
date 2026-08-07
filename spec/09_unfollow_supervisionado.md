# Prompt 09 — Execução supervisionada de unfollow

Continue o projeto existente. Use os planos imutáveis gerados pelo planejador de unfollow.

Implemente unfollow apenas nos modos:

- `dry-run`;
- `manual`;
- `confirm-each`.

Não implemente unfollow autônomo em massa nesta fase.

Fluxo obrigatório:

1. carregar um plano de unfollow salvo;
2. verificar se o plano ainda é válido;
3. verificar sessão e conta ativa;
4. selecionar um único candidato elegível;
5. revalidar no banco:
   - `followed_by_tool = true`;
   - `followed_at` existente;
   - não está em whitelist;
   - não está protegido;
   - ainda não recebeu unfollow;
6. abrir o perfil correto;
7. confirmar username e URL;
8. verificar no Instagram se ainda está sendo seguido ou se há solicitação pendente;
9. verificar circuit breaker;
10. mostrar data do follow, campanha e motivo;
11. pedir confirmação explícita;
12. executar no máximo uma ação;
13. confirmar visualmente o novo estado;
14. registrar `unfollowed_at`, `unfollow_reason`, ação e evidência;
15. não repetir automaticamente em caso ambíguo.

Regras adicionais:

- conta sem histórico comprovado nunca pode ser processada;
- whitelist e proteção devem ser verificadas novamente imediatamente antes do clique;
- se o usuário já deixou de seguir manualmente, apenas sincronizar o estado sem clicar;
- se houver follow-back e a configuração mandar preservar, não executar;
- qualquer divergência entre plano, banco e página deve resultar em `NEEDS_REVIEW`;
- limite padrão de ações reais deve ser zero;
- parada deve ser imediata e sem retomada automática em aviso ou erro de segurança.

Crie comandos equivalentes a:

```bash
npm run dev -- unfollow --plan PLAN_ID --dry-run
npm run dev -- unfollow --plan PLAN_ID --mode manual --limit 1
npm run dev -- unfollow --plan PLAN_ID --mode confirm-each --limit 1
```

Crie testes com fixtures locais para todos os estados relevantes, incluindo divergência e atualização manual externa.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

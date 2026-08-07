# Prompt 07 — Curtida supervisionada de publicação recente

Continue o projeto existente. Neste projeto, “curtir” significa curtir uma publicação do perfil, não uma mensagem direta.

Implemente o workflow opcional de curtir no máximo uma publicação recente por candidato.

Mantenha os modos:

- `dry-run`;
- `manual`;
- `confirm-each`.

Não implemente curtidas autônomas em lote.

Fluxo:

1. verificar sessão e conta ativa;
2. abrir o candidato selecionado;
3. confirmar username e tipo do perfil;
4. verificar se o perfil está acessível e possui publicação visível;
5. selecionar uma publicação recente conforme regra documentada;
6. abrir a publicação;
7. detectar se já está curtida;
8. mostrar URL da publicação e pedir confirmação;
9. executar no máximo uma curtida;
10. confirmar visualmente o novo estado;
11. registrar ação e URL da publicação;
12. não repetir no mesmo perfil durante a mesma campanha, salvo decisão explícita futura.

Casos que devem resultar em `SKIPPED` ou `NEEDS_REVIEW` sem clique:

- perfil privado sem acesso;
- perfil sem publicação;
- publicação já curtida;
- modal ou estrutura desconhecida;
- aviso, CAPTCHA ou desafio;
- mudança da conta ativa;
- publicação indisponível.

Crie comandos equivalentes a:

```bash
npm run dev -- like-post --campaign "nome" --dry-run
npm run dev -- like-post --username usuario --mode manual
npm run dev -- like-post --username usuario --mode confirm-each
```

Crie testes com fixtures locais para publicação curtida, não curtida, perfil privado, sem publicação e estado desconhecido.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

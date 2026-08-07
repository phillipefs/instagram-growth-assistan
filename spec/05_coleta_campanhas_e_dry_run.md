# Prompt 05 — Coleta de candidatos, filtros e dry-run

Continue o projeto existente. Leia e respeite o `AGENTS.md`.

Implemente o workflow de coleta de uma pequena amostra de seguidores de um perfil-alvo em modo somente leitura.

Crie comandos equivalentes a:

```bash
npm run dev -- campaign:create --name "nome" --target @perfil
npm run dev -- collect-followers --campaign "nome" --limit 20
npm run dev -- candidates:list --campaign "nome"
npm run dev -- plan-follow --campaign "nome" --dry-run
```

Requisitos da coleta:

- verificar sessão e conta ativa antes de iniciar;
- abrir o perfil-alvo;
- reconhecer o estado da página;
- abrir a lista de seguidores apenas para leitura;
- coletar até o limite informado;
- normalizar username e URL;
- evitar duplicados;
- registrar campanha, origem e data de descoberta;
- pausar entre páginas somente por razões técnicas de carregamento, sem tentar imitar comportamento humano;
- parar diante de aviso, desafio, CAPTCHA, sessão expirada ou estado desconhecido;
- persistir progresso para retomada;
- não executar follow ou qualquer outra ação de relacionamento.

Implemente filtros locais configuráveis:

- excluir usernames duplicados;
- excluir whitelist;
- excluir contas protegidas;
- excluir contas já seguidas;
- excluir contas com estado desconhecido;
- permitir lista manual de bloqueio;
- permitir aprovação e rejeição manual.

O `plan-follow --dry-run` deve produzir uma prévia com:

- total coletado;
- total filtrado;
- total aprovado;
- motivos de exclusão;
- candidatos propostos;
- nenhuma ação real.

Crie suporte a exportação CSV e JSON da prévia, sem dados sensíveis de sessão.

Adicione testes para deduplicação, filtros, retomada e parada de segurança.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

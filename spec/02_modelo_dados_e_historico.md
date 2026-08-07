# Prompt 02 — Banco, campanhas e histórico de relacionamentos

Continue o projeto existente. Leia primeiro `AGENTS.md`, `SPEC.md`, `ARCHITECTURE.md`, `DECISIONS.md` e o código atual.

Implemente o modelo de dados local em SQLite com migrações versionadas.

Crie entidades ou tabelas equivalentes para:

## Instagram accounts

- identificador interno;
- username;
- URL do perfil;
- data de primeira identificação;
- data da última verificação;
- status da sessão;
- nunca armazenar senha ou token copiado manualmente.

## Campaigns

- id;
- nome;
- perfil-alvo de origem;
- URL do perfil-alvo;
- descrição;
- status;
- data de criação e atualização.

## Candidates

- id;
- username normalizado;
- URL do perfil;
- campanha de origem;
- perfil-alvo de origem;
- data da descoberta;
- estado atual;
- motivo de filtro ou bloqueio;
- campos básicos observados, quando disponíveis;
- garantia de não duplicação por conta do Instagram e username.

## Relationships

- conta local do Instagram;
- candidato;
- status do relacionamento;
- `followed_at`;
- `followed_by_tool`;
- origem do follow;
- `follow_requested_at`, quando aplicável;
- `followed_back` como valor desconhecido, verdadeiro ou falso;
- `followed_back_checked_at`;
- `unfollowed_at`;
- `unfollow_reason`;
- `whitelisted`;
- `protected`;
- data de criação e atualização.

## Actions

- tipo: collect, inspect, follow, like-post, unfollow, skip, protect;
- conta ativa;
- candidato;
- campanha;
- estado anterior;
- estado posterior;
- resultado;
- erro normalizado;
- data de início e conclusão;
- idempotency key;
- caminho opcional de screenshot ou trace.

## Runs

- tipo de execução;
- modo;
- configuração usada;
- status;
- contadores;
- data de início e fim;
- motivo de parada.

Implemente repositórios tipados e transações.

Regras obrigatórias:

- armazenar datas em UTC e apresentar datas no fuso configurado;
- nunca selecionar para unfollow uma relação sem `followed_by_tool = true` por padrão;
- impedir duplicação de ações concluídas usando idempotency keys;
- registrar auditoria suficiente para reconstruir o que ocorreu;
- não apagar histórico ao atualizar o estado atual.

Crie uma máquina de estados explícita e testada, incluindo pelo menos:

```text
DISCOVERED
FILTERED
APPROVED
FOLLOW_PENDING
FOLLOW_REQUESTED
FOLLOWED
LIKE_PENDING
LIKED
UNFOLLOW_ELIGIBLE
UNFOLLOW_PENDING
UNFOLLOWED
PROTECTED
SKIPPED
NEEDS_REVIEW
FAILED
```

Implemente comandos de desenvolvimento para:

- criar/migrar o banco;
- inserir fixtures;
- listar campanhas;
- listar candidatos;
- mostrar o histórico de um username;
- resetar somente os dados de teste mediante confirmação explícita.

Não implemente navegador nem ações reais nesta fase.

Crie testes unitários e de integração para migrações, repositórios, idempotência e transições inválidas.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

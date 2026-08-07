# Prompt 13 — Revisão final, simplificação e entrega do MVP

Faça uma revisão completa do projeto existente sem adicionar novas funcionalidades de automação.

Objetivos:

- reduzir complexidade desnecessária;
- confirmar que todas as regras de segurança são aplicadas;
- identificar código duplicado;
- confirmar idempotência e recuperação;
- revisar mensagens da CLI;
- garantir que o modo padrão continua sendo `dry-run`;
- garantir que ações reais exigem modo explícito e confirmação;
- garantir que nenhuma função de evasão foi implementada;
- garantir que unfollow só usa histórico local comprovado;
- garantir que whitelist e proteção são verificadas imediatamente antes de qualquer ação;
- garantir que a conta ativa é verificada antes de cada workflow.

Execute:

- auditoria de dependências;
- lint;
- typecheck;
- testes unitários;
- testes de integração;
- testes e2e em fixtures locais;
- build de produção.

Atualize:

- `README.md` com instalação e primeiros passos;
- `ARCHITECTURE.md` com o estado final;
- `SPEC.md` marcando requisitos concluídos e pendentes;
- `DECISIONS.md` com decisões finais;
- `TODO.md` somente com itens reais;
- `TESTING.md`;
- `VALIDATION_PLAN.md`.

Crie `HANDOFF.md` contendo:

- visão geral do produto;
- comandos disponíveis;
- modos de execução;
- modelo de dados;
- fluxos de follow, curtida e unfollow;
- proteções;
- limitações conhecidas;
- procedimento para recuperar uma execução interrompida;
- procedimento para atualizar localizadores quando a interface mudar;
- checklist antes de usar uma conta real;
- riscos e itens que exigem decisão humana.

Apresente no final:

1. árvore resumida do projeto;
2. comandos principais;
3. resultado de todos os testes;
4. funcionalidades concluídas;
5. funcionalidades deliberadamente não implementadas;
6. riscos abertos;
7. próxima decisão recomendada.

Não implemente execução autônoma em massa nesta revisão.

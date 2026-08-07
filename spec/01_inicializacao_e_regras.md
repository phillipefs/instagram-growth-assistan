# Prompt 01 — Inicialização, especificação e regras permanentes

Você está trabalhando na pasta do projeto atual. Crie a base de um aplicativo local chamado `automation-seguidores` para validar, de forma supervisionada, um assistente de campanhas no Instagram.

Antes de implementar funcionalidades de navegador, faça o seguinte:

1. Inspecione a pasta atual e preserve qualquer arquivo existente.
2. Inicialize um projeto Node.js com TypeScript.
3. Use versões estáveis e compatíveis das dependências.
4. Configure:
   - TypeScript em modo estrito;
   - ESLint;
   - Prettier;
   - Vitest;
   - Playwright;
   - Zod;
   - SQLite com uma biblioteca adequada para Node.js;
   - logger estruturado.
5. Crie scripts para:
   - `npm run dev`;
   - `npm run build`;
   - `npm run lint`;
   - `npm run typecheck`;
   - `npm test`;
   - `npm run test:e2e`.

Crie estes documentos:

- `AGENTS.md`;
- `SPEC.md`;
- `ARCHITECTURE.md`;
- `DECISIONS.md`;
- `TODO.md`;
- `README.md`.

O `AGENTS.md` deve estabelecer regras permanentes:

- o modo padrão é somente leitura e `dry-run`;
- nenhuma ação real deve ser habilitada sem fase explícita posterior;
- usar navegador visível;
- login deve ser manual;
- nunca armazenar usuário ou senha;
- falhar de forma fechada: estado desconhecido significa não clicar;
- parar em CAPTCHA, desafio, aviso de atividade, sessão expirada ou troca da conta ativa;
- nunca implementar proxies de evasão, stealth, fingerprint spoofing, solução de CAPTCHA ou mecanismos destinados a ocultar automação;
- não descrever limites internos como “limites seguros do Instagram”;
- não repetir automaticamente ações cujo resultado não foi confirmado;
- registrar logs, screenshots e traces em erros;
- somente follows com histórico local comprovado poderão entrar no planejador automático de unfollow;
- whitelist e contas protegidas nunca podem receber unfollow;
- toda mudança deve preservar testes e documentação.

O `SPEC.md` deve definir:

- objetivos do MVP;
- funções de coleta, campanha, follow, curtida de publicação e unfollow;
- máquina de estados dos candidatos;
- modos `read-only`, `dry-run`, `manual` e `confirm-each`;
- critérios de aceite;
- casos de erro;
- itens explicitamente fora do escopo.

Use como estrutura inicial:

```text
src/
  cli/
  config/
  database/
  domain/
  browser/
  instagram/
  workflows/
  safety/
  observability/
tests/
  unit/
  integration/
  fixtures/
data/
evidence/
  screenshots/
  traces/
```

Não abra o Instagram e não implemente cliques nesta fase.

Ao terminar:

1. execute lint, typecheck e testes;
2. corrija todos os problemas encontrados;
3. mostre a árvore dos arquivos principais;
4. resuma decisões arquiteturais;
5. liste pendências;
6. não avance para outra fase.

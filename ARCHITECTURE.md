# ARCHITECTURE.md

## Visão geral

Aplicativo CLI local em Node.js + TypeScript (estrito). A automação de interface
usa Playwright em navegador visível, com login manual. O estado e a auditoria
ficam em SQLite local. A configuração é validada por Zod e os logs são
estruturados (pino) com mascaramento de dados sensíveis.

## Estrutura de pastas

```text
src/
  cli/            # Entrada da linha de comando (commander)
  config/         # Caminhos operacionais e schema de configuração (Zod)
  database/       # Migrações e repositórios SQLite (fase futura)
  domain/         # Entidades e máquinas de estado separadas
  browser/        # Abstração BrowserSession (fase futura)
  instagram/      # Adaptadores de reconhecimento da interface (fase futura)
  workflows/      # Coleta, follow, curtida, unfollow (fases futuras)
  safety/         # SafetyMonitor e circuit breaker (fase futura)
  observability/  # Logger estruturado, evidências
tests/
  unit/           # Testes unitários de domínio e configuração
  integration/    # Banco, transações, idempotência (fase futura)
  e2e/            # Playwright contra fixtures locais (fase futura)
  fixtures/       # Páginas HTML simuladas
```

## Decisões estruturais principais

1. **Dados operacionais fora do workspace.** `resolveDataRoot` aponta para
   `%LOCALAPPDATA%/automation-seguidores` (ou equivalente), evitando sincronizar
   banco, cookies e evidências pelo OneDrive. Diverge deliberadamente da pasta
   `data/` dentro do repositório sugerida nos rascunhos iniciais.
2. **Máquinas de estado separadas.** Campanha, relacionamento, origem,
   follow-back, ação, plano, run e segurança têm ciclos de vida próprios, em vez
   de uma única máquina de candidato.
3. **Proveniência explícita.** `origin` distingue clique da ferramenta, clique
   manual observado, importação e preexistência. Só `TOOL_CLICK` é elegível ao
   unfollow automático por padrão.
4. **Segurança e idempotência antes das ações.** O núcleo do `SafetyMonitor`,
   as chaves de idempotência e a recuperação são implementados antes do primeiro
   clique real (reordenação em relação à numeração original dos prompts).
5. **`supervised-batch` explícito.** O lote é supervisionado, com plano imutável,
   confirmação única, limite obrigatório e revalidação por item — não é execução
   autônoma.

## Sequência de implementação (revisada)

1. Inicialização e tooling (esta fase).
2. Segurança/config validada + contratos de domínio.
3. Banco e repositórios.
4. Sessão e login manual.
5. Reconhecimento somente leitura.
6. Coleta e dry-run.
7. Núcleo de execução e recuperação.
8. Follow supervisionado.
9. Curtida de publicação.
10. Reconciliação de follow-back.
11. Planejamento e execução de unfollow.
12. Robustez, observabilidade e testes transversais.
13. Experimento de validação e entrega.

## Estado atual

Fase 01 concluída: tooling, estrutura, configuração, logger, contratos de estado
e testes unitários. Nenhum acesso ao Instagram implementado.

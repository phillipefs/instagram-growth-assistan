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
  database/       # Migrações e repositórios SQLite
  domain/         # Entidades e máquinas de estado separadas
  browser/        # Sessão visível, leituras e ações supervisionadas
  instagram/      # Localizadores e sinais da interface
  workflows/      # Coleta, planos, execução, reconciliação e relatórios
  safety/         # SafetyMonitor, guardas e lease por conta
  observability/  # Logger estruturado, evidências
tests/
  unit/           # Testes unitários de domínio e configuração
  integration/    # Banco, workflows, transações e idempotência
  e2e/            # Playwright contra fixtures HTML locais
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

## Sequência de implementação adotada

1. Inicialização e tooling.
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

O MVP está implementado como assistente local e supervisionado. A CLI possui
sessão Playwright visível com login manual, coleta por engajamento, planos
imutáveis, follow, curtida, reconciliação de resultados ambíguos, snapshots de
seguidores, planejamento e execução de unfollow, runs auditáveis e métricas de
conversão por campanha e no total.

Ações reais continuam desabilitadas por padrão: exigem modo explícito, limite
positivo, confirmação e, para follow/unfollow, plano congelado. CAPTCHA,
checkpoint, aviso de atividade, troca de conta ou interface desconhecida causam
parada fechada sem retomada automática.

O SQLite, o perfil do navegador, screenshots e traces ficam fora do workspace.
O histórico preserva a origem de cada relacionamento; somente ciclos
`TOOL_CLICK` podem entrar no planejador automático de unfollow. Snapshots
incompletos de seguidores ficam registrados para diagnóstico, mas não substituem
o último snapshot completo.

O núcleo do `SafetyMonitor`, o modelo de lease e a tabela `safety_events` estão
implementados. A integração centralizada desses três componentes em todos os
comandos de execução permanece registrada como débito técnico; hoje as paradas
de segurança são aplicadas pelos detectores, pela sessão e pelas guardas de cada
workflow.

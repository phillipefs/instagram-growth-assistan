# Prompt 10 — Segurança operacional e circuit breaker

Continue o projeto existente e faça uma revisão transversal de segurança operacional.

Implemente um `SafetyMonitor` central usado por todos os workflows.

Estados mínimos:

```text
SAFE
PAUSED
SUSPENDED
NEEDS_MANUAL_REVIEW
SESSION_EXPIRED
ACCOUNT_CHANGED
CAPTCHA_DETECTED
CHALLENGE_DETECTED
WARNING_DETECTED
UNKNOWN_INTERFACE
```

Implemente parada imediata quando detectar:

- CAPTCHA;
- desafio ou checkpoint;
- aviso de atividade;
- sessão expirada;
- conta ativa diferente;
- navegação para domínio inesperado;
- estado de interface desconhecido;
- repetição de erro;
- resultado de ação não confirmado;
- inconsistência entre banco e página.

Regras:

- `automatic_resume = false`;
- nenhuma ação deve ocorrer quando o estado não for `SAFE`;
- não resolver nem contornar desafios;
- não tentar clicar em botões “prováveis”;
- não implementar stealth, proxy de evasão, fingerprint spoofing ou CAPTCHA solver;
- não implementar lógica destinada a descobrir limites ocultos;
- limites configuráveis servem apenas para impedir excesso acidental;
- o padrão de qualquer limite real deve ser zero;
- toda ação real exige modo explícito e confirmação;
- depois de uma parada, exigir revisão manual e novo comando do usuário.

Implemente configuração validada por Zod semelhante a:

```yaml
execution:
  mode: dry-run
  visibleBrowser: true
  confirmationRequired: true
  automaticActionsEnabled: false

safety:
  stopOnWarning: true
  stopOnUnknownState: true
  stopOnSessionChange: true
  automaticRetryActions: false
  automaticResume: false
  parallelAccounts: false

unfollow:
  onlyToolRecordedFollows: true
  preserveWhitelist: true
  preserveProtected: true
  requirePreview: true
  requireConfirmation: true
```

Adicione um comando de diagnóstico que explique por que o sistema está bloqueado, sem executar ações.

Crie testes garantindo que nenhum workflow consiga ignorar o `SafetyMonitor`.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

# Prompt 03 — Sessão persistente, navegador visível e login manual

Continue o projeto existente e leia todos os documentos de projeto antes de alterar o código.

Implemente o gerenciamento seguro de uma sessão Playwright local.

Requisitos:

- usar Chromium ou Chrome em modo visível;
- usar um diretório de perfil persistente exclusivo deste projeto;
- nunca usar automaticamente o perfil pessoal padrão do Chrome;
- nunca armazenar usuário ou senha;
- permitir que o usuário faça login manualmente;
- não tentar preencher credenciais;
- detectar se a sessão está autenticada;
- identificar e registrar o username da conta ativa;
- comparar a conta ativa com a conta configurada antes de qualquer workflow;
- parar se a conta ativa mudar;
- fornecer comando para abrir o navegador para login manual;
- fornecer comando para verificar a sessão em modo somente leitura;
- fornecer comando explícito para apagar o perfil local, com confirmação.

Implemente uma abstração de `BrowserSession` com ciclo de vida previsível e encerramento seguro.

Implemente detecção conservadora dos seguintes estados:

- autenticado;
- não autenticado;
- sessão expirada;
- desafio de segurança;
- CAPTCHA;
- aviso ou checkpoint;
- interface desconhecida.

Quando houver dúvida, classifique como `UNKNOWN` e não prossiga.

Crie fixtures HTML locais e testes Playwright contra páginas simuladas. Não use ações reais em contas de terceiros durante testes automatizados.

O comando de verificação deve gerar um relatório semelhante a:

```text
Browser profile: configurado
Visible browser: sim
Session: autenticada | não autenticada | desconhecida
Active account: @username | desconhecida
Safety state: ok | blocked | needs-review
```

Não implemente coleta, follow, curtida ou unfollow nesta fase.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

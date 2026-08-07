# AGENTS.md — Regras permanentes

Estas regras valem para qualquer pessoa ou agente que trabalhe neste projeto.
Elas têm precedência sobre pedidos pontuais. Toda mudança deve preservar testes
e documentação.

## Modo de operação

- O modo padrão é **somente leitura** e **`dry-run`**.
- Nenhuma ação real é habilitada sem uma fase explícita e um modo explícito.
- O limite real padrão de qualquer ação é **zero**. O usuário precisa informar um
  limite positivo para que qualquer ação real ocorra.
- Sempre usar **navegador visível**.
- O login é **manual**. A ferramenta nunca preenche credenciais.
- **Nunca** armazenar usuário, senha, token ou cookie copiado manualmente.

## Falha fechada

- Estado desconhecido significa **não clicar**.
- Parar imediatamente em: CAPTCHA, desafio/checkpoint, aviso de atividade,
  sessão expirada, troca da conta ativa, domínio inesperado, interface
  desconhecida, repetição de erro, resultado não confirmado ou divergência entre
  banco e página.
- Não repetir automaticamente ações cujo resultado não foi confirmado.
- Nunca há retomada automática após uma parada de segurança. É exigido novo
  comando explícito do usuário.

## Proibições permanentes

- Nunca implementar proxies de evasão, browser stealth, spoofing de fingerprint,
  solução/contorno de CAPTCHA ou qualquer mecanismo para ocultar automação.
- Nunca descrever limites internos como "limites seguros do Instagram".
- Nunca implementar execução paralela em várias contas.
- Nunca implementar mensagens diretas automáticas ou reações a mensagens diretas.
- Nunca implementar descoberta ou contorno de limites internos da plataforma.
- Nunca implementar intervalos aleatórios com o objetivo de imitar comportamento
  humano. Pausas existem apenas por razões técnicas de carregamento.

## Regras de dados e histórico

- Somente follows com **histórico local comprovado** (`origin = TOOL_CLICK`)
  entram no planejador automático de unfollow.
- **Whitelist** e **contas protegidas** nunca recebem unfollow.
- Follow-backs **não são preservados por padrão** (decisão do usuário): todo
  follow feito pela ferramenta (`origin = TOOL_CLICK`) é elegível ao unfollow,
  tenha ou não seguido de volta. A proteção é por **origem** — follows manuais /
  fora da ferramenta, whitelist e protegidos nunca entram. Preservar follow-backs
  pode ser reativado por configuração (`preserveFollowBacks = true`).
- Ações manuais observadas nunca são rotuladas como ações da ferramenta.
- Datas são armazenadas em **UTC** e apresentadas no fuso configurado.
- O histórico nunca é apagado ao atualizar o estado atual.

## Dados operacionais fora do workspace

- Banco de dados, perfil do navegador, screenshots e traces ficam em
  `%LOCALAPPDATA%/automation-seguidores` (ou equivalente), **nunca** dentro da
  pasta do projeto, que pode ser sincronizada pelo OneDrive.
- Nenhuma credencial, cookie, banco ou trace é versionado.

## Conformidade

- A automação por interface está sujeita a mudanças de layout e às regras da
  plataforma. Limites configuráveis servem apenas para impedir excesso
  acidental, não para garantir segurança perante o Instagram.
- Antes de qualquer teste em conta real, é exigido aceite explícito de risco.

# TUTORIAL — Instalação em outra máquina

Guia para **copiar o projeto para outro computador** e deixá-lo funcionando do
zero. Este cenário assume que você **não** quer manter o histórico da máquina
atual: o banco de dados começa **vazio** na máquina nova.

> Regra de ouro: **não copie `node_modules`.** Ele é reinstalado no destino, e um
> de seus pacotes (`better-sqlite3`) é compilado para cada máquina/sistema — copiar
> a pasta pronta costuma quebrar.

---

## 1. O que copiar (e o que não copiar)

Copie a **pasta inteira do projeto**, exceto:

| Pasta/arquivo | Copiar? | Por quê |
|---|---|---|
| `src/`, `tests/`, `spec/` | ✅ Sim | Código-fonte e testes. |
| `package.json` e **`package-lock.json`** | ✅ Sim | O lockfile garante as versões exatas. |
| `tsconfig*.json`, `eslint*`, `playwright.config.*`, `*.md` | ✅ Sim | Configuração e documentação. |
| `node_modules/` | ❌ **Não** | Reinstalado com `npm ci`. Módulo nativo quebra se copiado. |
| `dist/` | ❌ Não | Recriado com `npm run build`. |
| `.git/` (se existir) | ❌ Opcional | Histórico de versão; não é necessário para rodar. |

### Copiando no Windows (excluindo as pastas pesadas)
```powershell
robocopy "C:\caminho\origem\seguidores" "D:\caminho\destino\seguidores" /E /XD node_modules dist .git
```
> `/E` copia subpastas; `/XD` exclui as pastas listadas. Se preferir copiar via
> pen drive/zip, apague `node_modules` e `dist` **antes** de compactar.

---

## 2. Pré-requisitos na máquina nova

- **Node.js 20 ou superior** (o projeto foi testado no 24) e **npm**.
  ```bash
  node --version
  npm --version
  ```
- Windows, macOS ou Linux.
- Conexão de internet (para baixar as dependências e o navegador).

---

## 3. Instalar as dependências

Na pasta copiada:

```bash
# instala EXATAMENTE as versões do package-lock.json (recompila o better-sqlite3)
npm ci

# baixa o navegador (Chromium) que a ferramenta controla — fica num cache fora do node_modules
npx playwright install chromium
```

> Se você não tiver o `package-lock.json` por algum motivo, use `npm install` no
> lugar de `npm ci`.

---

## 4. Banco de dados: começar do zero

Você **não precisa** trazer o histórico da outra máquina. Os dados operacionais
(banco, login do navegador, evidências) ficam **fora** da pasta do projeto, em
`%LOCALAPPDATA%\automation-seguidores\` — como você não vai copiar essa pasta, a
máquina nova já começa limpa.

Crie o banco novo:

```bash
npm run dev -- db:migrate
npm run dev -- db:status     # confere as migrações aplicadas
```

Confirme onde os dados serão gravados:

```bash
npm run dev -- paths:show
```

> Consequência de começar do zero: o histórico de quem a ferramenta seguiu **não
> vem junto**. Ou seja, na máquina nova o `plan-unfollow` só vai considerar
> follows feitos **a partir de agora** por esta instalação. Isso é o esperado
> neste cenário.

---

## 5. Primeiros passos (configuração inicial)

```bash
# 1. registra sua conta local (sem senha/token)
npm run dev -- account:create --username <sua_conta>

# 2. cria uma campanha apontando para um perfil-alvo do seu nicho
npm run dev -- campaign:create --name "Minha Campanha" --target <perfil_alvo>

# 3. abre o Chrome visível: FAÇA LOGIN você mesmo e feche a janela
npm run dev -- session:open

# 4. confere que a sessão está autenticada e é a conta certa
npm run dev -- session:check --account <sua_conta>
```

O login fica salvo no perfil local do navegador (fora do OneDrive); você não
precisa repetir a cada uso.

---

## 6. Verificar que está tudo certo

```bash
npm run build       # compila (deve terminar sem erro)
npm test            # suíte unitária/integração
npm run test:e2e    # testes de navegador com fixtures (sem tocar no Instagram)
```

Se tudo passar, siga o fluxo normal do [TUTORIAL.md](TUTORIAL.md): `collect` →
`plan-follow` → `plan:create-follow` → `follow` → (esperar) → `plan-unfollow` →
`plan:create-unfollow` → `unfollow`.

---

## 7. Solução de problemas

**`npm ci` falha compilando o `better-sqlite3`**
Na maioria das vezes ele baixa um binário pronto para Node 20/22/24. Se a máquina
tiver um Node muito novo/diferente e precisar compilar, instale as *Build Tools*
do Visual Studio (workload "Desktop development with C++") no Windows, ou o
`build-essential`/`python3` no Linux, e rode `npm ci` de novo.

**O navegador não abre / erro do Playwright**
Rode novamente `npx playwright install chromium`. O navegador não fica no
`node_modules`, então precisa ser baixado uma vez por máquina.

**`node: command not found` ou versão antiga**
Instale o Node 20+ (recomendado o LTS mais recente) e reabra o terminal.

**Quero recomeçar o banco do zero (na mesma máquina)**
```bash
npm run dev -- db:reset --confirm
npm run dev -- db:migrate
```

**Onde estão o banco e o login?**
```bash
npm run dev -- paths:show
```
Tudo fica em `%LOCALAPPDATA%\automation-seguidores\` (Windows). Apagar essa pasta
zera o histórico e o login.

---

## Resumo rápido

```bash
# na máquina nova, dentro da pasta copiada (sem node_modules):
npm ci
npx playwright install chromium
npm run dev -- db:migrate
npm run dev -- account:create --username <sua_conta>
npm run dev -- campaign:create --name "Minha Campanha" --target <perfil_alvo>
npm run dev -- session:open        # login manual
npm run dev -- session:check --account <sua_conta>
```
Pronto: instalação limpa, banco novo, sem histórico da máquina anterior.

# Comandos úteis do dia a dia

Exemplo usado neste arquivo:

```text
Conta:    appassetlens
Campanha: professor_vicente
Target:   professorvicenteguimaraes
```

## 1. Conferir sessão

```bash
npm run dev -- session:check --account "appassetlens"
```

Se não estiver autenticado:

```bash
npm run dev -- session:open
```

O login é manual e o navegador é visível.

## 2. Ver campanhas e resumos

Para criar uma campanha nova (execute uma única vez por campanha):

```bash
npm run dev -- campaign:create --name "professor_vicente" --target "professorvicenteguimaraes"
```

Não repita esse comando se `professor_vicente` já existir.

Listar todas as campanhas:

```bash
npm run dev -- campaigns:list
```

Resumo da campanha:

```bash
npm run dev -- candidates:list --campaign "professor_vicente" --summary --account "appassetlens"
```

Campos principais:

- `candidates.total`: total de candidatos na campanha;
- `postsWithSignals`: posts que geraram candidatos/sinais;
- `currentRelationships.total`: seguindo + solicitações enviadas;
- `remaining.eligible`: candidatos que ainda podem entrar em um plano;
- `remaining.neverAttempted`: candidatos sem nenhuma tentativa anterior;
- `latestFollowAttempts.ambiguous`: tentativas com resultado não confirmado.

Resumo global do target, juntando todas as campanhas dele:

```bash
npm run dev -- target:summary --username "professorvicenteguimaraes"
```

Campos principais:

- `campaigns.total`: campanhas ligadas ao target;
- `instagramReportedPosts`: total mostrado no cabeçalho do Instagram;
- `collection.postsObserved`: posts distintos encontrados;
- `collection.postsWithPublishedAt`: posts com data conhecida;
- `collection.newestPostPublishedAt`: post observado mais recente;
- `collection.oldestPostPublishedAt`: post observado mais antigo;
- `collection.uniqueCandidates`: candidatos únicos entre todas as campanhas.

## 3. Coletar candidatos

Exemplo para percorrer 20 posts e extrair até 2.000 comentaristas por post,
encerrando ao alcançar 20.000 candidatos únicos:

```bash
npm run dev -- collect --campaign "professor_vicente" --posts 20 --limit 20000 --comments-per-post 2000 --account "appassetlens"
```

Para continuar a partir do post 21:

```bash
npm run dev -- collect --campaign "professor_vicente" --skip-posts 20 --posts 20 --limit 20000 --comments-per-post 2000 --account "appassetlens"
```

Repetições não duplicam o mesmo candidato nem o mesmo sinal do mesmo post.

## 4. Conferir quem nunca foi tentado

Prévia somente leitura:

```bash
npm run dev -- plan-follow --campaign "professor_vicente" --only-unattempted --limit 50 --account "appassetlens"
```

Observe `preview.totalProposed`. Esse comando não segue ninguém.

## 5. Criar e executar um plano de follow

Criar um plano com até 50 candidatos nunca tentados:

```bash
npm run dev -- plan:create-follow --campaign "professor_vicente" --only-unattempted --limit 50 --account "appassetlens"
```

Criar um plano somente com usernames exatos:

```bash
npm run dev -- plan:create-follow --campaign "neto_invest" --usernames "usuario1,usuario2"
```

Copie o `planId` retornado e execute:

```bash
npm run dev -- follow --plan "<PLAN_ID>" --mode supervised-batch --limit 50 --account "appassetlens"
```

Para execução não interativa já autorizada, acrescente `--yes`. Plano congelado,
modo real e limite positivo continuam obrigatórios.

Opcionalmente, pular perfis com menos de 20 seguidores:

```bash
npm run dev -- follow --plan "<PLAN_ID>" --mode supervised-batch --limit 50 --skip-inactive 20 --account "appassetlens"
```

Se o número de seguidores não puder ser lido, o perfil é enviado para revisão e
pulado sem clique; o lote continua.

Antes da ação, o botão `Seguir` é vinculado ao username e ao bloco de
estatísticas do alvo. Botões de `Sugestões para você` são ignorados mesmo dentro do
mesmo header. Ausência, duplicidade, instabilidade ou `Falha no carregamento`
do próprio cabeçalho pulam o item sem clique. Uma falha apenas na grade de posts
não invalida um botão principal reconhecido. A confirmação precisa permanecer estável em duas leituras.
Uma substituição técnica do nó pelo React é aceita somente se o novo botão continuar
estruturalmente ligado ao mesmo perfil. Estados provisórios de carregamento recebem
algumas releituras somente leitura antes de virar `UNKNOWN_INTERFACE`.
Não há segunda abertura no fluxo normal; uma recarga somente leitura ocorre apenas
se o clique foi despachado e a confirmação visual sumiu. Nessa exceção, respostas
do perfil também podem confirmar `friendship_status` para o username exato. Um resultado que continuar
desconhecido interrompe o lote por segurança.

## 6. Continuar depois de um follow ambíguo

Use o `runId` e o username mostrados na execução:

Se uma leitura posterior visual ou o `friendship_status` do username exato mostrar
`Seguindo`/`Solicitado`, confirme sem reclicar:

```bash
npm run dev -- follow:confirm-ambiguous --run "<RUN_ID>" --username "<USERNAME>" --confirm
```

Se o resultado continuar desconhecido, apenas libere o item sem repetir:

```bash
npm run dev -- follow:skip-ambiguous --run "<RUN_ID>" --username "<USERNAME>" --confirm
```

Depois, execute novamente **o mesmo plano**:

```bash
npm run dev -- follow --plan "<PLAN_ID>" --mode supervised-batch --limit 50 --account "appassetlens"
```

Os confirmados e o ambíguo reconciliado serão pulados; o processamento seguirá
nos itens restantes. Não crie outro plano para retomar esse lote.

## 7. Relatórios rápidos

Resumo agregado de toda a operação:

```bash
npm run dev -- metrics
```

Relatório da execução mais recente:

```bash
npm run dev -- runs:report
```

Relatório de uma execução específica:

```bash
npm run dev -- runs:report --run "<RUN_ID>"
```

Histórico de uma pessoa:

```bash
npm run dev -- history --username "<USERNAME>"
```

## 8. Unfollow da campanha

Prévia, sem ação:

```bash
npm run dev -- plan-unfollow --campaign "professor_vicente" --account "appassetlens"
```

Criar o plano:

```bash
npm run dev -- plan:create-unfollow --campaign "professor_vicente" --limit 50 --account "appassetlens"
```

Executar usando o `planId` retornado:

```bash
npm run dev -- unfollow --plan "<PLAN_ID_UNFOLLOW>" --mode supervised-batch --limit 50 --account "appassetlens"
```

Somente follows comprovadamente feitos pela ferramenta podem entrar no unfollow
automático. Whitelist e perfis protegidos ficam sempre excluídos.

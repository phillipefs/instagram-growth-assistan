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

Atualizar a base completa de seguidores antes de consultar conversão ou criar
um plano que preserve follow-backs:

```bash
npm run dev -- followers:sync --account "appassetlens"
npm run dev -- followers:status --account "appassetlens" --check "edu.brasileiro"
```

Resumo da campanha:

```bash
npm run dev -- campaign:summary --campaign "professor_vicente" --account "appassetlens"
```

Campos principais:

- `candidates.total`: total de candidatos na campanha;
- `postsWithSignals`: posts que geraram candidatos/sinais;
- `currentRelationships.total`: seguindo + solicitações enviadas;
- `relationshipHistory.unfollowed`: perfis que já tiveram unfollow;
- `followBacks.yes`: perfis observados seguindo a conta de volta;
- `followBacks.checked`: perfis já inspecionados, inclusive `UNKNOWN`;
- `followBacks.classified`: perfis classificados como `YES` ou `NO`;
- `followBacks.uninspected`: perfis que ainda aguardam inspeção;
- `followBacks.coveragePct`: percentual já inspecionado;
- `followersSnapshot.currentFromCampaign`: seguidores atuais presentes na campanha;
- `conversion.ratePct`: seguidores atuais da campanha / perfis seguidos pela ferramenta;
- `conversion.confirmedRatePct`: novos seguidores comprovados / perfis com baseline;
- `conversion.attributionUnknown`: perfis sem snapshot anterior suficiente para atribuição;
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

### Opção A — somente comentários

Primeira coleta da campanha: percorre os posts 1 a 20 e extrai até 2.000
comentaristas por post, encerrando ao alcançar 20.000 candidatos únicos.
`--skip-posts 0` é opcional porque zero já é o padrão:

```bash
npm run dev -- collect --campaign "professor_vicente" --skip-posts 0 --posts 20 --limit 20000 --comments-per-post 2000 --account "appassetlens"
```

### Opção B — comentários e curtidores

Para percorrer a mesma faixa e também tentar capturar quem curtiu cada post,
adicione `--likers`:

```bash
npm run dev -- collect --campaign "professor_vicente" --skip-posts 0 --posts 20 --limit 20000 --comments-per-post 2000 --likers --account "appassetlens"
```

Essa opção continua coletando comentários. O coletor abre o diálogo de curtidas,
rola a lista e acrescenta os usernames como `RECENT_POST_LIKERS`. Por padrão,
cada post é lido até o valor de `--limit`, antes da deduplicação entre posts;
use `--likers-per-post <n>` para impor outro teto por publicação.

Exemplo: pula os dois primeiros posts, abre uma publicação e tenta obter até 500
curtidores, além dos comentaristas:

```bash
npm run dev -- collect --campaign "argon_investimentos" --skip-posts 2 --posts 1 --limit 500 --comments-per-post 2000 --likers --likers-per-post 500 --account "appassetlens"
```

Se o Instagram não disponibilizar o diálogo, o resultado incrementa
`likersUnavailable`. Se a lista abrir mas parar de carregar antes do total ou do
limite, incrementa `likerListsIncomplete`. `likersCollected` informa quantos
usernames foram lidos das listas. Quando houver falha ou leitura parcial,
`likerIssues` mostra o post, o total esperado, o total carregado e o motivo. O
comando não curte posts nem segue ninguém.

Segunda coleta da mesma campanha: ignora os 20 primeiros posts e percorre os
posts 21 a 40:

```bash
npm run dev -- collect --campaign "professor_vicente" --skip-posts 20 --posts 20 --limit 20000 --comments-per-post 2000 --account "appassetlens"
```

Terceira coleta da mesma campanha: ignora os 40 primeiros posts e percorre os
posts 41 a 60:

```bash
npm run dev -- collect --campaign "professor_vicente" --skip-posts 40 --posts 20 --limit 20000 --comments-per-post 2000 --account "appassetlens"
```

`--skip-posts` sempre conta a partir do topo atual do grid do perfil-alvo; a
campanha não avança esse número automaticamente. Posts fixados também entram
nessa contagem.

Repetições não duplicam o mesmo candidato nem o mesmo sinal do mesmo post.

## 4. Conferir quem nunca foi tentado

Depois de qualquer uma das duas coletas, a prévia e o plano de follow são os
mesmos. Comentários e curtidas ficam na mesma campanha, com deduplicação; não
existe um plano separado por fonte. A ordenação prioriza comentaristas e usa os
sinais de curtida como pontuação adicional.

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
npm run dev -- metrics --account "appassetlens"
```

O bloco `Conversão de follow por campanha` mostra `seguidos`,
`seguiram_de_volta` e `conversão` para cada campanha. A linha `TOTAL (pessoas
únicas)` deduplica quem apareceu em mais de uma campanha. Rode `followers:sync`
antes para medir contra o snapshot aceito mais recente. O sync aceita até 1% de
diferença como `TOLERATED`; para métricas, essa base classifica presentes como
`YES` e ausentes como `NO` e informa data, cobertura e tolerância na fonte. Essa
suposição vale somente para o relatório: a execução de unfollow continua
preservando ausências incertas. Sem snapshot aceito, o relatório usa as
observações locais e informa a cobertura disponível.

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

Fluxo recomendado: atualizar primeiro a lista completa de seguidores e mostrar
uma prévia somente de quem continuou sem seguir de volta após 7 dias:

```bash
npm run dev -- followers:sync --account "appassetlens"
npm run dev -- plan-unfollow --campaign "professor_vicente" --no-follow-back-after 7 --only-unattempted --account "appassetlens"
```

`--no-follow-back-after 7` aplica o prazo individualmente a cada pessoa, usando a
data em que o follow ou a solicitação foi feito. Portanto, alguém adicionado hoje
não entra no plano só porque a campanha é antiga. O parâmetro também preserva
automaticamente `YES` e `UNKNOWN` e exige que o `NO` tenha sido observado depois
de a pessoa completar os 7 dias de espera.

Criar o plano com a mesma regra:

```bash
npm run dev -- plan:create-unfollow --campaign "professor_vicente" --no-follow-back-after 7 --only-unattempted --account "appassetlens"
```

Para apenas manter follow-backs, mas sem exigir um prazo mínimo, ainda é possível
usar a opção anterior:

```bash
npm run dev -- plan-unfollow --campaign "professor_vicente" --preserve-follow-backs --only-unattempted --account "appassetlens"
```

Executar usando o `planId` retornado:

```bash
npm run dev -- unfollow --plan "<PLAN_ID_UNFOLLOW>" --mode supervised-batch --limit 50 --account "appassetlens"
```

Somente follows comprovadamente feitos pela ferramenta podem entrar no unfollow
automático. Whitelist e perfis protegidos ficam sempre excluídos.
`--only-unattempted` também exclui qualquer perfil com tentativa anterior de
unfollow. Na execução, perfis `FOLLOWING` são buscados na janela “Seguindo” e
processados ali; solicitações pendentes ou resultados não encontrados usam a
página individual como fallback.

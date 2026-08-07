# Prompts sequenciais — Automation Seguidores

Use estes prompts **na ordem numérica**, sempre dentro da pasta do projeto `automation seguidores`.

## Como usar

1. Abra o Codex na pasta do projeto.
2. Cole o conteúdo de `01_inicializacao_e_regras.md`.
3. Aguarde o Codex concluir, executar os testes e apresentar o resumo.
4. Revise os arquivos criados.
5. Só então cole o prompt seguinte.
6. Não pule fases.

## Regra para avançar

Só avance quando o Codex confirmar que:

- `npm run lint` passou;
- `npm run typecheck` passou;
- `npm test` passou;
- a documentação foi atualizada;
- não há ações reais do Instagram habilitadas antes da fase correspondente;
- os itens pendentes estão registrados em `DECISIONS.md` ou `TODO.md`.

## Escopo validado

O produto deverá, de forma local e supervisionada:

- coletar seguidores de um perfil-alvo;
- organizar candidatos em campanhas;
- sugerir e registrar follows;
- curtir no máximo uma publicação recente por candidato, quando habilitado;
- registrar data e origem de cada follow;
- criar filas de unfollow por período, campanha e outros filtros;
- deixar de seguir apenas contas com histórico local comprovado;
- manter whitelist e contas protegidas;
- possuir modo de simulação, confirmação, pausa e parada imediata;
- interromper em CAPTCHA, desafio, aviso de segurança ou estado desconhecido.

## Fora do escopo

Não implementar:

- proxies para ocultação;
- browser stealth;
- spoofing de fingerprint;
- resolução ou contorno de CAPTCHA;
- rotação de contas após restrição;
- descoberta ou contorno de limites internos do Instagram;
- intervalos aleatórios com o objetivo de imitar comportamento humano;
- execução paralela em várias contas;
- mensagens diretas automáticas;
- reações a mensagens diretas;
- painel SaaS, pagamentos ou múltiplos clientes nesta validação.

A expressão “curtir” neste projeto significa **curtir uma publicação recente do perfil**, não curtir mensagens diretas.

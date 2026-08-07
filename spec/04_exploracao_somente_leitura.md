# Prompt 04 — Exploração e reconhecimento somente leitura

Continue o projeto existente. Respeite integralmente o `AGENTS.md`.

Implemente uma camada de reconhecimento da interface do Instagram em modo somente leitura.

Objetivo desta fase: abrir páginas e identificar estados sem executar follow, curtida, unfollow ou qualquer outra alteração.

Crie módulos separados para:

- reconhecimento da página de perfil;
- identificação do username exibido;
- detecção de perfil público, privado, indisponível ou inexistente;
- identificação do estado aparente do relacionamento;
- localização do acesso à lista de seguidores;
- reconhecimento do modal ou página de seguidores;
- extração de links e usernames visíveis;
- reconhecimento da grade de publicações;
- reconhecimento de avisos, desafios e estados desconhecidos.

Prefira localizadores semânticos, texto acessível, roles e relações estruturais. Evite depender exclusivamente de classes CSS geradas.

Centralize os localizadores em um adaptador para facilitar manutenção.

Implemente um comando somente leitura:

```bash
npm run dev -- inspect-profile --url URL_DO_PERFIL
```

O relatório deve incluir:

- URL solicitada e URL final;
- username identificado;
- tipo de perfil;
- estado do relacionamento identificado;
- presença de seguidores e publicações;
- estado de segurança;
- campos desconhecidos;
- screenshot de diagnóstico opcional.

Implemente também:

```bash
npm run dev -- inspect-session
```

Nesta fase:

- não clique em Seguir;
- não abra uma publicação com intenção de curtir;
- não clique em Deixar de seguir;
- não execute JavaScript para alterar a página;
- não capture dados além do necessário para validar o reconhecimento.

Adicione testes usando fixtures locais que cubram idiomas ou variantes de interface quando possível.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

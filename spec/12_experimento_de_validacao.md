# Prompt 12 — Modo de experimento e relatório de validação

Continue o projeto existente. Não aumente a autonomia das ações.

Implemente suporte a um experimento controlado para validar utilidade e confiabilidade.

Crie um conceito de experimento contendo:

- nome;
- conta local usada;
- campanha;
- período;
- modo de execução;
- critérios de inclusão;
- tamanho máximo da amostra;
- objetivos;
- métricas;
- status;
- observações manuais.

Métricas técnicas:

- candidatos coletados;
- candidatos filtrados;
- perfis reconhecidos corretamente;
- estados desconhecidos;
- ações propostas;
- ações aprovadas;
- ações confirmadas;
- ações ambíguas;
- duplicidades evitadas;
- retomadas bem-sucedidas;
- paradas de segurança.

Métricas de produto:

- tempo manual gasto;
- tempo estimado economizado;
- taxa de aprovação dos candidatos;
- taxa de follow-back, quando verificada manualmente ou por método permitido;
- resultado por campanha;
- comparação entre somente follow e follow mais curtida, sem extrapolar conclusões.

Crie comandos equivalentes a:

```bash
npm run dev -- experiment:create
npm run dev -- experiment:status EXPERIMENT_ID
npm run dev -- experiment:report EXPERIMENT_ID --format markdown
```

O relatório deve deixar explícito:

- que não existe garantia de ausência de restrição da plataforma;
- que limites internos não representam limites oficiais seguros;
- quais ações foram manuais e quais foram executadas após confirmação;
- erros e estados desconhecidos;
- se a engenharia foi validada;
- se o valor do produto foi validado;
- riscos ainda abertos.

Crie `VALIDATION_PLAN.md` com um roteiro progressivo:

1. fixtures locais;
2. sessão somente leitura;
3. coleta pequena;
4. dry-run;
5. execução manual;
6. confirmação individual em contas próprias ou autorizadas;
7. revisão dos resultados;
8. nenhuma ampliação de autonomia sem decisão explícita.

Ao terminar, execute lint, typecheck e testes, atualize a documentação e não avance para outra fase.

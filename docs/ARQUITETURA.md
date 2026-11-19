# Arquitetura do Observatório (v0.1)

## Visão funcional

```text
CGU (com token) ---- GitHub Actions --> adaptador --> normalização / privacidade
                                       |           -> dados mensais canônicos
                                       |           -> manifesto pequeno
                                       +---- validação ----> commit de JSON
                                                              |
                                                              v
                                                     GitHub Pages (sem token)
                                                     filtros / gráficos / fichas
```

As consultas autenticadas não são disparadas pelo navegador. O Secret `CGU_API_KEY` deve ser configurado separadamente neste repositório.

## Modelo público inicial

- `data/manifest.json`: `schema_version`, `unit`, `status`, `months`, `updated_at` quando há alteração.
- `data/months/AAAA-MM.json`: `documents`, `relations`, `coverage`.
- Documentos: `{id,date,phase,cents}`, em que `phase` é 1 (NE), 2 (NS) ou 3 (pagamento).
- Relações confirmadas: `{from,to,cents}`, inicialmente NS → NE via empenhos impactados; não deduzir pagamentos a partir da proximidade de datas e valores.
- Cobertura por data/fase: `{date,phase,complete,count,invalid}`, com `reason` para truncamentos e `unlinked` quando houver impacto sem identificador de NE verificável.

Valores são **centavos inteiros**. `null` significa valor não recuperado. Uma consulta incompleta não gera total monetário definitivo. Nenhum documento é duplicado no mês; a janela recente substitui somente os registros da data e fase reconsultadas, nunca os meses antigos.

Os arquivos são carregados sob demanda pelo navegador. Totais de fase e gráficos são derivados em tempo de leitura, sem JSONs redundantes de agregados.

## Privacidade obrigatória

A regra de CPF é `***.123.456-**`: ocultar as três primeiras e as duas últimas posições, mantendo os seis dígitos centrais. Não armazenar CPF integral em entrada, logs, GitHub Actions, cache ou JSON público. A primeira versão **não publica favorecidos ou textos livres**, evitando a replicação prematura de dados pessoais. `src/privacy.mjs` implementa a função de mascaramento para os próximos módulos e `src/store.mjs` bloqueia campos inesperados.

CPF parcial não serve como chave única e não representa anonimização irreversível. Relacionamentos de pessoas físicas não podem ser deduzidos por comparação dos seis dígitos.

## Limitações explícitas

- Apenas documentos CGU da UG 158459; ainda não inclui fornecedores, itens, PNCP/SIOP/SIDRA ou exercícios inteiros.
- Não há comparação ou conciliação com o Tesouro Gerencial.
- Um pagamento da CGU pode ter natureza de documento diferente de OB; o identificador é preservado.
- A API de empenhos impactados é usada na fase NS quando o valor direto está ausente. Vínculos só são registrados quando o número da NE é validado.
- Falhas na coleta não sobrescrevem deliberadamente arquivos de meses íntegros com informação fictícia.
- Repetição do mesmo conjunto de dados não gera alteração material; os arquivos do Git ainda acumulam histórico quando há mudanças reais.

## Próximas etapas

1. Backfill histórico com checkpoints e rechecagem seletiva de períodos fechados.
2. Catálogo reutilizável de favorecidos (CPF sempre mascarado), processos e classificações.
3. Itens de empenho, vínculos para pagamentos, fornecedores finais e fichas detalhadas.
4. Integradores PNCP/Compras.gov.br, SIOP e SIDRA, com schemas e proveniência próprios.
5. Relatórios exportáveis e controle de qualidade por fonte.

Todos os conectores futuros deverão respeitar os mesmos testes de privacidade, isolamento e idempotência.

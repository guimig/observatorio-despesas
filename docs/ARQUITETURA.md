# Arquitetura do Observatório (v0.1)

## Visão funcional

```text
CGU (com token) ---- GitHub Actions --> adaptador --> normalização / privacidade
                                       |           -> dados mensais canônicos
                                       |           -> manifesto pequeno
                                       +---- validação ----> commit de JSON
                                                              |
                                                              v
                                           build allowlist --> artefato Pages
                                           (workflow_call após commit de JSON)
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

O workflow de publicação por Actions empacota exclusivamente os arquivos públicos em `dist/`; não publica todo o repositório. A rotina de coleta chama explicitamente o workflow de Pages quando os JSONs são modificados, pois commits criados com `GITHUB_TOKEN` não acionam workflows de push subsequentes. Os arquivos são carregados sob demanda pelo navegador. Totais de fase e gráficos são derivados em tempo de leitura, sem JSONs redundantes de agregados.

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

1. Backfill histórico por lotes de até sete dias e checkpoints em `coverage` (implantação inicial com workflow próprio e retomada automática da competência anterior).
2. Catálogo reutilizável de favorecidos (CPF sempre mascarado), processos e classificações.
3. Itens de empenho, vínculos para pagamentos, fornecedores finais e fichas detalhadas.
4. Integradores PNCP/Compras.gov.br, SIOP e SIDRA, com schemas e proveniência próprios.
5. Relatórios exportáveis e controle de qualidade por fonte.

Todos os conectores futuros deverão respeitar os mesmos testes de privacidade, isolamento e idempotência.

## Cobertura versus completude

Uma consulta de uma data/fase pode ser completa (paginação encerrada), mas isso **não significa** que todos os dias da competência tenham sido coletados. Para a interface, dias esperados são todos os dias encerrados da competência na zona `America/Sao_Paulo`; cada dia só é considerado coberto quando as três fases foram consultadas integralmente e não há valores inválidos. A interface indica `dias completos / dias previstos` e não representa uma janela parcial como total mensal.

O backfill seleciona primeiro os dias que não estejam plenamente cobertos, sem arquivo redundante de checkpoint. Em cada execução, poucos dias são coletados e normalizados, os demais arquivos mensais permanecem intactos. A opção `recheck` permite atualizar um dia anteriormente concluído.

## Publicação por artefato GitHub Actions

O workflow `.github/workflows/publicar-pages.yml` é reutilizável e pode ser chamado após o commit do coletor; mantém o mesmo ponto de entrada estático da interface (`index.html`) e aplica validação de privacidade antes de empacotar o site. Em Settings → Pages, a fonte deve ser **GitHub Actions**, nunca a branch `main` diretamente. O arquivo `dist/` é transitório e não é versionado.

## Enriquecimento seguro da CGU

Uma sondagem estrutural do retorno da API confirmou os campos `codigoFavorecido`, `nomeFavorecido`, `numeroProcesso`, `grupo`, `elemento`, `programa` e `acao` nas três fases. O normalizador utiliza esses campos explicitamente, sem inferir relacionamentos a partir de nomes ou valores semelhantes.

O JSON mensal contém opcionalmente `beneficiaries`, um catálogo de **pessoas jurídicas indexado por CNPJ**, com nome armazenado uma única vez por competência. Os documentos utilizam `partyRef`. Pessoas físicas utilizam exclusivamente `cpfMasked`, no padrão `***.123.456-**`, sem nome de PF nem chave única de identidade. Os dados podem conter também `process` e `nature` (grupo, elemento, programa e ação), quando disponíveis. Os documentos preexistentes sem esses campos continuam válidos.

O campo livre `observacao` permanece **não publicado** até haver um sanitizador e validação específicos para dados bancários, dados pessoais e textos contendo outras informações sensíveis. As interfaces e exportações usam somente campos da lista permitida.


## Relações de pagamento e itens de empenho (próxima etapa)

O adaptador `src/enrich-cgu.mjs` lê apenas duas consultas oficiais: `despesas/empenhos-impactados?fase=3`, para vínculo de pagamento a NE, e `despesas/itens-de-empenho` para conteúdo estruturado dos itens. As fontes são acessadas no backend do GitHub Actions, nunca no navegador.

**Persistência mínima sem novas coleções redundantes:**

- `documents[].paymentLinksChecked: true`: a consulta de impacto do pagamento terminou com paginação completa; se não houve impactos, esse estado evita consultas repetidas.
- `relations[]`: os vínculos das fases 2 e 3 para NEs são armazenados com valores em centavos, usando os IDs documentais existentes. Para fase 3, os campos `valorPago` e `valorRestoPago` são somados por NE/subitem; nunca são subtraídos de outras fases para calcular saldo.
- `itemsByDocument[NE]`: itens de empenho sanitizados; uma lista vazia significa consulta concluída sem itens, enquanto chave ausente indica consulta ainda pendente. Os campos são `seq`, `code`, `sub`, `subdesc`, `description` e `cents` (quando disponíveis).

**Retomada e retificações:** o coletor recente preserva vínculos e itens de documentos com mesmo identificador/valor. Caso o valor documental mude, os enriquecimentos desse documento são invalidados e devem ser reconsultados. O enriquecimento é armazenado após cada documento concluído, com validação integral dos arquivos; itens não concluídos não recebem marca de sucesso.

**Privacidade:** observações livres e respostas brutas continuam proibidas. Descrições de itens são opcionalmente publicadas após sanitização conservadora; identificadores pessoais, e-mails, telefones e dados bancários visíveis levam à supressão da descrição. CPF nunca sai em formato completo, e nomes de pessoas físicas não são publicados.

**Ponto de atenção:** a ausência de um documento na competência atual não significa que o vínculo não exista: uma NE pode ter sido emitida em outro exercício, ainda não carregado no acervo. A interface busca competências adicionais sob demanda e informa quando a referência não está disponível.

Integração PNCP e Compras.gov.br permanece planejamento subsequente: a ligação precisa de identificadores oficiais do processo/contrato, não apenas coincidência de descrição ou valores.


## Catálogo contratual PNCP/Compras.gov — primeiro integrador

- **Unidades:** UG Araquari `158459`, CNPJ filial `10635424000348`, Reitoria `10635424000186`. A publicidade pelo CNPJ da Reitoria não implica competência executora da filial; contratos são identificados como `scope: ifc` ou `scope: campus` somente conforme unidade explicitada nos registros.
- **Fonte PNCP:** `GET /api/consulta/v1/contratos` com dataInicial/dataFinal, CNPJ de cada órgão e paginação integral. Para evitar atribuição indevida, o sistema valida o CNPJ da resposta e distingue unidade `unidadeOrgao.codigoUnidade`.
- **Fonte Compras.gov:** `/modulo-uasg/1_consultarUasg` para descobrir `codigoOrgao` e `/modulo-contratos/1_consultarContratos` filtrado pela UG 158459 e intervalo de início da vigência. Consulta exige código do órgão confirmado; nenhum código é inventado a partir da UO.
- **Retenção:** apenas `data/procurement/contracts.json`, um catálogo de instrumentos com ID estável por fonte, vigência, processo, CNPJ PJ, CPF mascarado PF, objeto sanitizado e valores em centavos. Não se armazenam snapshots brutos nem documentos SIAFI duplicados.
- **Cobertura:** fonte e competência com `complete`, `partial` ou `unavailable`; HTTP 404 não equivale a zero. Falhas nunca substituem cobertura antes completa. Resultados novos só entram no catálogo com paginação consistente e validação de esquema.
- **Vínculo confirmado:** código de NE coincidente com o instrumento de unidade Araquari. **Vínculo contextual:** processo formal e CNPJ PJ coincidindo com os do documento CGU. Associação contextual não prova execução nem é usada em somatórios financeiros.
- **Privacidade:** identificação de PF exclusivamente `***.123.456-**`; nenhum nome de PF ou descrição que contenha potencialmente CPF, contatos, e-mails ou dados bancários é persistido. CNPJs PJ permanecem públicos; fontes e documentos brutos não são versionados.
- **Deploy:** o workflow de coleta de contratos não usa credencial, compartilha o grupo de concorrência das demais coletas para evitar conflito de push e chama `publicar-pages.yml` depois de alterações efetivas nos JSONs. O Pages publica apenas o catálogo validado e não o código ou arquivos temporários.

O primeiro diagnóstico da PNCP não encontrou contratos em outubro/novembro de 2026 sob o CNPJ exclusivo da filial. As consultas institucionais devem ser tratadas como escopo IFC, sujeitas à confirmação de unidade, processo e fornecedor; a consulta de cadastro UASG no Compras.gov retornou HTTP 404 e é considerada indisponibilidade da fonte, não ausência de contratos.

A expansão seguinte poderá consultar contratações PNCP específicas referenciadas por `numeroControlePNCPCompra`, seus itens e atos, além de integrar a base Compras quando a consulta da UASG estiver operacional.

## Regra de atribuição de campus sob publicação centralizada

A Reitoria do IFC concentra a publicação de licitações e contratos sob a **UASG 158125**. O campo PNCP `unidadeOrgao.codigoUnidade` descreve uma unidade informada na publicação; não se pode usar a UASG publicadora como unidade financeira que empenhou a despesa. As NEs financeiras de Araquari têm prefixo `158459`, seguido de código de gestão e número de documento SIAFI; a CGU apresenta essas referências em forma integral. Exemplo de formato: `158459264222026NE000011`. Não converter `2026NE000011` em NE integral sem a UG/gestão efetivamente identificadas.

A partir de agora, o campo contratual `scope` representa o **cadastro de publicação** (`ifc` para CNPJ Reitoria, `campus` apenas para CNPJ próprio do campus), não o destinatário do gasto. O frontend calcula a atribuição separadamente, com regras auditáveis compartilhadas em `assets/procurement-links.js`. A tela padrão mostra somente candidatos; o acervo completo está disponível pelo filtro `Todos os contratos do IFC`.

A API de integração PNCP `/api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/empenhos` contém `numeroEmpenho`. A rotina `src/collect-pncp-commitments.mjs` verifica um lote limitado de contratos por execução (preferindo indícios de Araquari), sem dados pessoais, sem chaves, em `data/procurement/contracts.json`. Guarda somente `commitmentStatus`, `commitmentAt` e `commitmentRefs` da UG 158459. Estado `unavailable` não é o mesmo que ausência de empenhos; consultas incompletas nunca são marcadas como concluídas. Contratos retificados têm checkpoints invalidados para reconsulta.

O processo SIPAC iniciado por `23349` é forte **indício** de origem local, mas não é comprovação de execução de contrato e não deve ser único filtro. Há contratações centralizadas excepcionais que podem atender Araquari com processos de outros prefixos; essas surgirão por NE integral, mesmo sem `23349`.

Licitações e contratações diretas têm coleção própria no PNCP: `/api/consulta/v1/contratacoes/publicacao`. Isso deverá ser integrado por modalidade (pregão eletrônico/presencial, concorrência, concurso, diálogo competitivo, dispensa, inexigibilidade, etc.), com filtro de Reitoria para obtenção e atribuição individual por NE/processo, jamais pelo publicador.


## Publicações de licitações e contratações diretas PNCP

O catálogo `data/procurement/notices.json` é independente dos contratos e do financeiro CGU. A coleta utiliza `/api/consulta/v1/contratacoes/publicacao` com os códigos oficiais das **14 modalidades** e CNPJ publicador da Reitoria `10635424000186`. Cada competência/modalidade mantém cobertura própria (`complete`, `partial`, `unavailable`), com falha de API tratada explicitamente.

A normalização reduz os registros ao identificador PNCP, número, modalidade, processo, objeto público sanitizado, valores estimado/homologado em centavos, situação, indicador SRP, data e unidade informada pela fonte. Não se armazenam respostas completas ou dados pessoais.

A exibição por padrão é **indiciária**: processo SIPAC `23349` ou contratação vinculada por ID PNCP a contrato com NE confirmada de Araquari. O atributo de unidade da licitação ou o CNPJ publicador da Reitoria **não** equivale à UG executora. Todas as publicações do IFC podem ser consultadas pelo filtro explícito; a ausência de vínculo não prova inexistência de execução pelo campus.

O workflow de consulta pode completar modalidades diferentes em momentos distintos; falhas nunca removem publicações anteriores. O GitHub Pages recebe o catálogo somente quando validado pela allowlist do build.


## Cruzamento de contratos com contratações pelo ID oficial

Uma sondagem publicada no PR #18 verificou que o serviço documentado `/api/pncp/v1/orgaos/{cnpj}/contratos/contratacao/{ano}/{seq}` retornou HTTP 400 nos exemplos reais testados. Em compensação, a consulta **individual de contrato** `/api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{seq}` retornou `numeroControlePncpCompra:string`, que não constava da consulta mensal resumida. Esse identificador é a chave estável para relacionar o contrato PNCP `-2-` à contratação PNCP `-1-`.

O adaptador `src/pncp-contract-link.mjs` obtém apenas a identificação de compra por número PNCP do contrato, validando o identificador da resposta antes de extrair o campo de origem. Contrato com `numeroControlePNCP` divergente não é associado. Nenhuma resposta bruta, nome de favorecido ou CPF é guardado. O estado de consulta (`procurementLinkStatus`, `procurementLinkAt`) é persistido junto com `procurementId` em `data/procurement/contracts.json`.

O coletor independente `src/collect-pncp-contract-links.mjs` e o workflow `vinculos-contratacoes-pncp.yml` processam lotes pequenos, validam o arquivo antes do commit e publicam a versão atualizada pelo Pages. Campos de aquisição originária sobrevivem às atualizações periódicas do catálogo somente se número, unidade e processo do instrumento permanecerem iguais. Retificações explicitamente divergentes invalidam a referência antiga e exigem nova consulta.

O navegador utiliza o ID para montar ligações **contratação → contrato** e **contrato → contratação**, inclusive quando suas competências são diferentes. A interface rotula separadamente o *elo PNCP institucional* e a *evidência da UG executora*. Não se somam valores contratuais e orçamentários nem se inferem notas de empenho a partir do nome ou valor.

Para a continuidade da cadeia, uma NE da UG 158459 explicitamente confirmada é necessária antes de classificar a contratação como executada por Araquari. O processo administrativo iniciado por `23349` é indício, nunca prova suficiente.


## Recuperação direta de editais por identificador PNCP

O caminho contrato→contratação gera `procurementId` que pode apontar a competência anterior à data de publicação do contrato. `src/pncp-notices-detail.mjs` recupera o detalhe oficial da compra sem varredura mensal (`/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`) e só aceita respostas cujo `numeroControlePNCP` coincide exatamente com o solicitado. Usa o normalizador existente, que elimina identificadores pessoais, textos livres inseguros e campos desnecessários.

A inserção em `notices.json` usa `applyDirectNotice`; deduplica por ID PNCP e acrescenta `coverage[month,modality]` como `partial` quando uma publicação é recuperada individualmente, sem declarar completude do período. Uma varredura posterior pode promover esse par a `complete`. Nenhum arquivo de histórico paralelo ou cache redundante é criado.

O workflow `recuperar-licitacoes-vinculadas.yml` tem paginação de trabalho por quantidade de IDs, escolha de pendências pela referência efetiva nos contratos, preferência por casos com processo 23349 e retry semanal de ausências/erros de fonte. A fonte de verdade da relação continua sendo o ID PNCP, e a condição de execução financeira requer NE da UG 158459.

**Proteção contra competição de commits:** jobs de coleta de escrita compartilham `concurrency.group=observatorio-coleta-main` e fazem checkout explícito de `main`. O uso do SHA do evento em jobs aguardando a fila causava push `non-fast-forward`; o novo checkout evita reaplicar dados sobre uma revisão anterior. O workflow do Pages já obtém `ref: main`.

**Ajuste da rota de consulta histórica (novembro de 2026):** a primeira tentativa com `/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}` não recuperou os registros amostrados. O adaptador passou a usar o endpoint público `/api/consulta/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`, documentado na API PNCP Consulta. Falhas são contabilizadas apenas por tipo (HTTP ou validação), sem dados pessoais ou respostas brutas nos logs.

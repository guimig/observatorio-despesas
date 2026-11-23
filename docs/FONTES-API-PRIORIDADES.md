# Prospecção de APIs oficiais para acompanhar despesas e restos a pagar

**Decisão de 23/11/2026:** priorizar **APIs governamentais consultáveis e atualizáveis** para a UG 158459. Não iniciar integração com o Tesouro Gerencial nem utilizar a base anual da STN para calcular saldos de RAP. Pesquisa documental de endpoints **não equivale a acesso testado, cobertura conferida ou homologação financeira**.

## Pergunta técnica

Para cada NE integral da UG 158459, que operações, pagamentos, cancelamentos e referências a RP podem ser observados na fonte pública **ao longo do exercício**? Uma base apenas de inscrições na virada do ano não responde à pergunta.

## Matriz de fontes candidatas

| Prioridade | Fonte oficial e consulta | Capacidade documental prevista | Limite/porta |
| --- | --- | --- | --- |
| P0 (em uso) | **CGU — Portal da Transparência**: `/api-de-dados/despesas/documentos`, `/documentos/{codigo}`, `/documentos-relacionados`, `/empenhos-impactados`, `/itens-de-empenho/historico` | Documentos de fases, trajetórias, textos de operações e impactos com campos `valorRestoPago`, `valorRestoInscrito` e `valorRestoCancelado`, quando retornados | Continuar cobertura histórica e consultas posteriores; ainda não prova saldo RAP a pagar, natureza RPP/RPNP ou completude contábil |
| P0 (candidato, **não testado**) | **Contratos.gov.br**, `GET /api/v1/empenho/rp` | Documentação o descreve como restos a pagar **alterados em determinado período** | Verificar autenticação, parâmetros obrigatórios, resposta, origem e semântica, correções, atualidade, cobertura e associação com UG 158459; serviço pode limitar-se a empenhos registrados no sistema de contratos |
| P0 (candidato, **não testado**) | **Contratos.gov.br**, `GET /api/v2/empenho`, `GET /api/v1/empenho/ano/{ano}/ug/{unidade}` | Empenhos alterados com paginação e consulta anual por UG, respectivamente | Não confundir UASG de contratação com UG financeira; conferir identificador SIAFI completo e cobertura real; não inventar contrato formal para NE substitutiva |
| P1 (complementar) | **PNCP Consulta**, `GET /v1/contratos/atualizacao`, `GET /v1/instrumentoscobranca/inclusao`; consulta por instrumento vinculado a contrato/empenho | Atualizações de publicações e instrumentos de cobrança | A publicação do instrumento de cobrança **não comprova liquidação nem pagamento**; publicação de contratos da Reitoria não prova execução da UG 158459 |
| P1 (fallback) | **CGU — download diário de despesas**: empenhos, itens, históricos, liquidações, pagamentos e respectivos impactos | Lotes oficiais de comparação caso a API não forneça cobertura histórica suficiente | Não é uma API transacional; validar data, arquivo, completude e chaves sem criar grandes bases ou commits repetitivos |
| Sem prioridade | **STN — base anual de avaliação de RP** | Recortes anuais e agregados de estoque, na sua granularidade publicada | Não serve como fonte de acompanhamento individual dinâmico de empenhos da UG; não usar para saldos do observatório |
| Suspenso | **Tesouro Gerencial / preflight contábil** | Possibilidade futura, sob governança própria | Usuário optou por **não integrar agora**; `src/rap-accounting-preflight.mjs` permanece isolado e não deve ser conectado ao pipeline, ao Pages ou a uma nova base |

### Documentações oficiais consultadas

- CGU: https://api.portaldatransparencia.gov.br/swagger-ui/index.html
- Arquivos diários CGU: https://portaldatransparencia.gov.br/download-de-dados/despesas/
- Contratos.gov.br: https://contratos.comprasnet.gov.br/api/docs
- PNCP Consulta: https://pncp.gov.br/api/consulta/swagger-ui/index.html
- Manual PNCP 2.6 (eventos de contratos e instrumentos de cobrança): https://pncp.gov.br/manual/pt-br/latest/singlehtml/
- Comunicado PNCP de atualização incremental de contratos/empenhos: https://www.gov.br/pncp/pt-br/central-de-conteudo/comunicados/2025/no-03-25-implantacao-da-consulta-aos-contratos-e-empenhos-por-data-de-atualizacao-no-pncp

## Protocolo de validação de uma nova API

1. **Catálogo real**: obter OpenAPI e identificar método, rota, parâmetros, paginação, autenticação e schema; verificação documental sem chamadas aos dados. Uma URL Swagger indexada pode estar inacessível no runner: registrar `network_unavailable`, não marcar o serviço como inexistente.
2. **Acesso real**: somente após confirmar parâmetros, fazer leitura de pequena janela e lote restrito da UG 158459. Respostas 401/403, HTTP 404, 429, timeout, erro de schema ou paginação não devem gerar linhas com valor zero.
3. **Identidade e escopo**: comparar chave SIAFI integral, UG, gestão, exercício, modalidade e vínculo de origem com exemplos já registrados na CGU; notas substitutivas e centralizadas exigem conferência independente. Nenhuma atribuição por processo ou nome.
4. **Evolução temporal**: distinguir data de emissão, data de alteração, data-base do status, ano da NE, ano da inscrição RP e atualização efetiva. Testar alteração posterior do mesmo empenho; não somar a mesma observação a cada coleta.
5. **Cobertura real**: confrontar amostra estratificada de empenhos da CGU com retorno da outra fonte, inclusive NEs sem contrato formal, antigo exercício, RP pago, RP cancelado e retorno sem registro; ausência na fonte não significa ausência de despesa.
6. **Semântica**: examinar se `rp` significa inscrição, inscrição atualizada, saldo operacional do Contratos.gov.br, baixa em contrato ou conta SIAFI. Campos financeiros não são automaticamente contábeis.
7. **Integração**: só após evidência positiva, criar adaptador incremental mínimo, proveniência por fonte/data-base, checkpoints e testes, sem base redundante, CPF ou segredo no cliente.

## Sondagem técnica implementada

O script `src/probe-official-apis.mjs` e workflow `sondar-fontes-oficiais.yml` inspecionam **somente as especificações OpenAPI** dos catálogos CGU, Contratos.gov.br e PNCP. Nunca realizam consultas de empenhos, valores ou documentos, não usam chave API, não guardam arquivos, não agendam cron e imprimem somente nomes de rotas, status e parâmetros públicos. A disponibilidade de rotas no OpenAPI não comprova que a consulta de dados funciona nem que a cobertura é da UG 158459.

**Marco imediato:** verificar a execução do diagnóstico dos metadados e, em nova PR, executar consultas mínimas e autenticadas apenas com credenciais já autorizadas (CGU), ou sem autenticação quando a fonte explicitamente permitir. Se Contratos.gov.br não oferecer acesso público ou não cobrir NEs não contratuais, manter CGU como fonte principal e não forçar integração.

**Proibição de inferência:** nenhum endpoint acima justifica exibir “RAP a pagar” como saldo definitivo sem consistência temporal, classificação e conciliação suficiente da fonte. A issue #29 continua aberta.

## Segunda etapa — prova pequena de acesso aos dados (23/11/2026)

Foi preparado o experimento **somente leitura** `src/probe-official-data.mjs` no workflow `sondar-dados-oficiais.yml`, disparado manualmente ou por alteração do próprio código. Ele consulta, sem token, **apenas as duas rotas públicas PNCP** de contratos/empenhos atualizados por data e instrumentos de cobrança inseridos. Janela móvel de 14 dias, filtrada pelo CNPJ publicador do IFC `10635424000186`, com **até duas páginas de dez registros por rota**. Resultado com paginação remanescente fica `sample_incomplete`, nunca `complete`.

A sondagem compara somente identificadores PNCP `-2-` exatos com o catálogo já coletado e, quando existir campo explícito `numeroEmpenho` contendo a **NE SIAFI integral da UG 158459**, verifica presença da mesma identidade no conjunto canônico CGU. Sem número integral, a correspondência financeira permanece **não verificada**. Também conta publicações anteriores à janela de atualização, sem presumir que houve modificação contábil ou pagamento. O teste de instrumentos de cobrança mede apenas a presença de referências oficiais PNCP, não notas liquidadas nem saldos.

A indisponibilidade do OpenAPI do Contratos.gov.br será investigada com quatro consultas de acesso anônimo de baixo volume: página de documentação, JSON OpenAPI, tentativa de `GET /api/v1/empenho/rp` **sem parâmetros** apenas para identificar barreira HTTP, e `GET /api/contrato/ug/158459` apenas para constatar código de resposta; nenhum corpo de registros da UG é processado nem publicado. Uma resposta HTTP 400/422 à rota sem parâmetros **não comprova acesso funcional**; 401/403 demonstra exigência de autenticação na solicitação testada. Documentação técnica de terceiros sugere restrição JWT às rotas de período; a fonte oficial precisa confirmar.

Todos os retornos são limitados em memória, o diagnóstico descarta payloads e registra apenas categorias/contagens; nenhuma resposta pessoal, CNPJ de fornecedor, CPF, número de NE, valor monetário, JSON novo ou credencial será publicada. Limites e formato foram cobertos por testes unitários. Os resultados observados no runner devem ser adicionados abaixo após a execução, sem afirmar validação de uma fonte ainda não testada.

**Aceite técnico:** CI, workflow read-only real, observação da paginação, controle de sobreposição e garantia de sigilo. **Aceite de integração:** exige evidência de cobertura da UG financeira, NEs substitutivas e cronologia dos eventos, além de validação semântica de RP. Não habilitar indicadores nem alterar o coletor regular.

## Verificacao real inicial e ajuste conservador (23/11/2026)

O [workflow #45229486002](https://github.com/guimig/observatorio-despesas/actions/runs/45229486002) executou chamadas reais sem credenciais. As duas rotas PNCP retornaram **HTTP 400 antes da primeira pagina** com `tamanhoPagina=5`; nao foi consultado nenhum registro, portanto todas as contagens de correspondencia ficaram em zero **por ausencia de leitura, nao por ausencia de dados**. No Contratos.gov.br, as quatro consultas de acesso (HTML, OpenAPI, GET de RP sem parametros e GET da UG apenas para status) terminaram com `network_unavailable` no runner. Isso nao permite concluir que as rotas exigem JWT ou que os dados nao existem.

A etapa de diagnóstico seguinte adotou `tamanhoPagina=10` (ate 20 registros por endpoint) e passou a informar limites numericos publicados no OpenAPI, quando disponiveis. Trata-se de uma **hipótese de validacao do parametro**, ainda sem resultado real da nova tentativa. Nenhuma chamada é repetida automaticamente em HTTP 400 e o motivo exato permanece pendente de verificacao por schema oficial.

## Resultado homologado da sondagem de acesso — 23/11/2026

O [workflow #45230126328](https://github.com/guimig/observatorio-despesas/actions/runs/45230126328) confirmou pelo **OpenAPI oficial**: `tamanhoPagina` admite **10–500** para `GET /v1/contratos/atualizacao` e **10–100** para `GET /v1/instrumentoscobranca/inclusao`. O HTTP 400 da execução anterior (lote 5) era compatível com parâmetro inválido; a [PR #117](https://github.com/guimig/observatorio-despesas/pull/117) passou a usar lote 10, com testes e publicação aprovados.

A [sondagem real #45230126287](https://github.com/guimig/observatorio-despesas/actions/runs/45230126287) retornou:

| Fonte/rota | Observação autenticada no runner | Consequência |
| --- | --- | --- |
| PNCP `/v1/contratos/atualizacao` | **2 de 16 páginas**, 20 registros, 20 IDs PNCP válidos, **6 IDs já presentes no catálogo local** e 14 com publicação anterior ao início da janela de atualização; nenhum campo `numeroEmpenho` com NE integral da UG 158459 na amostra | O endpoint está acessível e recupera publicações de datas anteriores que integram atualizações posteriores. Os resultados são **amostrais**, não contagem completa de 16 páginas nem evidência de vínculo com a CGU |
| PNCP `/v1/instrumentoscobranca/inclusao` | `network_unavailable` **antes da primeira página**; nenhuma linha foi validada | Não inferir ausência de documentos, erro de autenticação ou inexistência do serviço. Reavaliar em janela reduzida e com timeout documentado |
| Contratos.gov.br (HTML, OpenAPI, RP por período sem parâmetros e UG somente status) | Todos `network_unavailable` no runner, sem leitura de dados de UG | Não concluir que os endpoints exigem JWT, que faltam registros ou que o serviço não está publicado; suspender implementação até disponibilidade efetiva |
| CGU/Portal da Transparência | Fonte autenticada e principal já em funcionamento | Manter enriquecimento e histórico; não impor vínculos pela publicação PNCP |

**Interpretação obrigatória:** seis correspondências são exclusivamente **IDs de instrumentos PNCP** já catalogados, **não seis notas de empenho conciliadas**. A amostra não demonstrou chave financeira SIAFI integral; não vincular as demais publicações por número abreviado, processo, valor, fornecedor ou CNPJ do publicador.

### Próxima etapa de engenharia

1. Projetar um **coletor incremental PNCP por data de atualização**, usando o formato já validado, com paginação **integral** e status explícito em caso de falha/limite; nenhum JSON financeiro novo. O fluxo deve reconciliar cada ID PNCP com o catálogo existente e atualizar apenas campos oficiais efetivamente alterados, preservando registros de meses antigos e sem duplicar instrumento.
2. Medir latência, paginação e taxa de novos IDs antes de escolher janela ou agendamento diário; **16 páginas no intervalo de 14 dias não demonstram que o custo será sempre baixo**. Evitar varredura massiva, novos snapshots e commits sem mudança.
3. Testar separadamente `instrumentoscobranca/inclusao` com janela de um dia, CNPJ institucional e `tamanhoPagina=10`, sem assumir quitação.
4. Contratos.gov.br: fazer diagnóstico de conectividade e condições de consulta por período somente quando a rede permitir; não criar token/login nem depender dessa API no pipeline.
5. Preservar a CGU como fonte da identidade financeira, inclusive NEs substitutivas e N:M. Não publicar `RAP a pagar` sem prova de saldo.

As mudanças técnicas de sondagem não alteraram `data/months`, `data/procurement` ou o dashboard: apenas PRs, código e workflows de diagnóstico read-only.

## Coletor incremental PNCP por atualização global — 23/11/2026

**Escopo implantado:** consulta de `GET /api/consulta/v1/contratos/atualizacao` com os CNPJs oficiais da **Reitoria** (`10635424000186`) e do **Campus** (`10635424000348`). Filtro de data de atualização global, **não** de publicação nem execução financeira. O módulo `src/pncp-delta.mjs` reutiliza `normalizePncp`, `validateProcurement` e `mergePncpRecord`; a orquestração fica em `src/collect-pncp-delta.mjs`.

A cada execução automática, o coletor seleciona até **três dias civis encerrados**, conforme a data de São Paulo. Na primeira execução, inicia com os três dias completos anteriores; depois avança a partir do checkpoint `data/procurement/contracts.json.pncpDelta`, revisitando um dia de fronteira. O arquivo permanece **o mesmo catálogo existente**; o checkpoint mínimo `{since,through}` indica a **janela de atualização PNCP consultada**, **não** cobertura histórica por mês de publicação nem prova de execução financeira. O sistema não considera dias anteriores a `since` integralmente cobertos.

O coletor percorre **todas as páginas retornadas pela API** (`tamanhoPagina=100`, até **20 páginas por CNPJ e janela**). Uma resposta com mais páginas, erro HTTP, timeout, mudança de total, ID PNCP duplicado, CNPJ divergente ou resposta inválida **impede integralmente** a atualização do catálogo e o avanço do checkpoint. O workflow usa o mesmo grupo de concorrência das outras coletas, com gravação atômica, testes e validação de privacidade. Nenhuma mudança é salva ao primeiro erro; não existe persistência parcial escondida.

**Política inicial de integração conservadora:** aplica apenas alterações de instrumentos **já existentes no catálogo** e identificados pelo número PNCP oficial. O código preserva campos quando a API omite informações, recusa versões anteriores, invalida referências de empenho quando a identidade do instrumento muda e usa o comparador de revisões já existente. Novos IDs PNCP são contabilizados como **não catalogados**, sem inserção automática: a coleta mensal/backfill de publicação é responsável por incluí-los com controle adequado de cobertura. O número de registros desconhecidos não prova falta de contratação nem saldo de despesa.

O checkpoint só avança após janela integralmente verificada para **ambos os CNPJs**. O commit do GitHub contém somente revisão oficial de dados ou **novo intervalo de fonte confirmado** (informação material de cobertura); executar duas vezes na mesma data, sem novo dia, não gera outro commit nem outra consulta. O workflow `.github/workflows/atualizar-contratos-pncp.yml` executa diariamente às **13:47 UTC**, ou manualmente (1, 3 ou 7 dias por lote), sem novas credenciais e sem backend.

O experimento `src/probe-official-data.mjs` permanece **independente e somente leitura**; a rota PNCP de instrumentos de cobrança passou a ser sondada apenas para o **último dia UTC encerrado**, com máximo de 2 páginas de 10 registros. Essa consulta não grava instrumentos, não presume que nota fiscal seja liquidação nem cria pagamento/SIAFI a partir de PNCP.

**Observação operacional:** se a janela inteira exigir mais de 20 páginas para qualquer CNPJ, o lote não é marcado completo. A solução apropriada será reduzir o período por execução ou ampliar o teto apenas após aferir volumes e limites da fonte — nunca avançar o checkpoint após truncamento. O campo `pncpDelta` é metadata de leitura, não fonte de saldo de RAP.

**Rollback:** reverter a PR do coletor, retirar o workflow novo e deixar o catálogo anterior intacto; versões de JSON com `pncpDelta` são válidas somente no schema estendido. Não reescrever histórico Git nem apagar checkpoints de forma destrutiva.

## Homologação operacional da primeira janela incremental — 23/11/2026

A [PR #119](https://github.com/guimig/observatorio-despesas/pull/119) foi integrada à `main`, com CI aprovado. A [execução real #45237116602](https://github.com/guimig/observatorio-despesas/actions/runs/45237116602) concluiu com sucesso: janela **2026-11-20 a 2026-11-22**, consultas completas dos CNPJs Reitoria e Campus (1 página sem dados por origem), **zero registros de atualização retornados nesta janela**, nenhum contrato alterado, checkpoint `pncpDelta:{since:'2026-11-20',through:'2026-11-22'}` gravado no catálogo existente e commit de dados `1e6060d`. A publicação vinculada também concluiu com sucesso. O acervo manteve **76 instrumentos PNCP** e sua cobertura mensal existente. Zero na janela **não significa inexistência de contratos ou despesas**, apenas que a API não retornou atualizações nesse recorte temporal e com esses filtros.

A [sondagem independente #45237116697](https://github.com/guimig/observatorio-despesas/actions/runs/45237116697) retornou `http_404` para `GET /v1/instrumentoscobranca/inclusao` ao consultar somente **2026-11-22**. Este HTTP 404 não foi interpretado como resultado vazio; verificar o comportamento oficial da rota para datas sem inclusão ou eventual indisponibilidade antes de construir coletor. O Contratos.gov.br permaneceu `network_unavailable` nas quatro verificações anônimas, sem indicação conclusiva de autenticação ou acesso público.

**Próxima avaliação operacional:** observar novos dias do PNCP incremental, verificar se o lote diário apresenta atualizações e revisões materiais no catálogo, e manter a proteção contra commits repetidos no mesmo dia. Se forem identificados IDs não catalogados na atualização, recuperar suas competências pela coleta mensal/retroativa com cobertura explícita, não por associação heurística. O usuário não autorizou integração com Tesouro Gerencial; seguir priorizando CGU e APIs oficiais consultáveis.

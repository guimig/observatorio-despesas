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

## Próxima etapa — recuperação de IDs PNCP atualizados mas ainda não catalogados

A rotina incremental da PR #119 confirmava atualizações em janelas fechadas, mas contabilizava os IDs inéditos sem preservar uma forma de recuperá-los; isso poderia deixar lacuna em meses antigos. O novo mecanismo mantém **somente identificadores PNCP públicos e mês original**, no campo opcional `pncpDelta.pendingPublications` do catálogo já existente. A fila é única, ordenada e limitada a **500 identificadores**, sem resposta bruta, texto livre, valores, CPF nem nova base. Exceder o limite bloqueia o checkpoint, em vez de descartar pendências.

O script `src/recover-pncp-publications.mjs` escolhe **um mês de publicação por execução** e reutiliza a consulta mensal PNCP já implementada (`scanPncp`, com até 25 páginas por CNPJ). Depois de consulta integral dos dois CNPJs e sem registros rejeitados, exige que **todos os IDs pendentes daquele mês apareçam efetivamente**. Só então integra os registros ao catálogo via `mergeProcurement` e retira as pendências confirmadas. Um HTTP 404, falha de rede, paginação incompleta, documento ausente ou divergência de estrutura não provoca exclusão nem nova cobertura artificial. A data de atualização PNCP não é tomada como data contábil ou data de emissão da NE.

A recuperação é executada depois da coleta diária, inclusive quando a janela incremental do dia já está concluída; portanto, uma fila pendente não fica sem oportunidade de retry. Se a consulta incremental tiver sido bem-sucedida e a recuperação falhar, o checkpoint da primeira consulta pode ser preservado com as pendências intactas, registrando `unavailable` ou `unresolved_publications` de forma explícita. Documentos PNCP continuam no catálogo de origem, sem dupla contagem com empenhos CGU.

A sondagem independente `instrumentoscobranca/inclusao` passa a comparar, **apenas em caso de 404 ou indisponibilidade**, a consulta de um dia encerrado com a do último dia útil anterior (máximo de uma página de dez registros para a comparação). Esse controle ajuda a avaliar se a indisponibilidade é específica da data; **nenhum 404 é convertido automaticamente em zero ou ausência de cobrança**. Instrumento de cobrança não equivale a NS/OB nem a saldo de RAP. A recuperação de publicações de contratos PNCP não passa a persistir instrumentos de cobrança.

**Aceite:** CI com cobertura de limites, duplicidades, falhas, recuperação efetiva de ID, preservação de checkpoint e idempotência; diagnóstico somente leitura da cobrança após merge. Se um mês exigir mais páginas do que o teto, mantê-lo pendente e avaliar divisão por data, sem ampliar o limite às cegas.

## Validação operacional da fila e do contraste de cobrança — 23/11/2026

A [PR #121](https://github.com/guimig/observatorio-despesas/pull/121) foi integrada à `main` (merge `db78f3599ff1ba6742c244fefb5ceb1c80dde20f`), com testes sintéticos aprovados na [CI #45239687276](https://github.com/guimig/observatorio-despesas/actions/runs/45239687276). No [workflow real #45239782198](https://github.com/guimig/observatorio-despesas/actions/runs/45239782198), o checkpoint permaneceu em **2026-11-22** porque a nova janela ainda não estava aberta em 23/11, e a fila retornou `no_pending`: nenhum commit ou consulta desnecessária. A coleta mensal existente e a publicação Pages foram concluídas com sucesso. **A recuperação efetiva de ID desconhecido está validada por testes sintéticos, não por caso real**; não atribuir cobertura histórica retroativa.

A [sondagem #45239782416](https://github.com/guimig/observatorio-despesas/actions/runs/45239782416) consultou instrumentos de cobrança PNCP em **22/11/2026 (domingo)** e **20/11/2026 (sexta-feira)**, ambos com `http_404` **antes da primeira página**. Portanto, não foi confirmada a hipótese de falha específica do domingo; tampouco foi provado que não existam cobranças do IFC. A especificação da rota permanece publicada no [OpenAPI oficial do PNCP](https://pncp.gov.br/api/consulta/swagger-ui/index.html); o próximo teste, se necessário, deve verificar janela histórica com efetivas publicações ou consulta de acesso sem filtro do órgão, com **tamanho de página limitado** e sem divulgar corpo ou dados pessoais. Contratos.gov.br permaneceu `network_unavailable` em todos os quatro testes de acesso anônimo, sem diagnóstico conclusivo sobre autenticação.

A recuperação por mês não será presumida em produção até surgir ID pendente e sua publicação ser confirmada pela rota oficial. O coletor continua bloqueando avanço de checkpoint em caso de fila acima do limite, divergência de mês ou paginação insuficiente. Nenhum indicador de pagamento ou RAP foi alterado.

## Diagnóstico comparativo da API de cobrança — etapa de 23/11/2026

O [OpenAPI oficial do PNCP](https://pncp.gov.br/api/consulta/swagger-ui/index.html) declara `cnpjOrgao` como **opcional** na rota `GET /v1/instrumentoscobranca/inclusao`, com `dataInicial`, `dataFinal` e `pagina` obrigatórios e tamanho de página de **10 a 100**. A investigação anterior registrou `http_404` em 20 e 22/11/2026 filtrando o IFC; **não** comprovou ausência de documentos.

A nova rotina `node src/probe-official-data.mjs --billing-historical` consulta somente **duas datas históricas predefinidas** (15/10/2026 e 13/11/2026), em duas modalidades de acesso: com `cnpjOrgao=10635424000186` e **sem** o filtro institucional. São **quatro requisições no máximo**, cada uma com `pagina=1`, `tamanhoPagina=10`, limite de 3 MiB e timeout de 16 segundos. O modo sem filtro foi limitado **exclusivamente** a `instrumentoscobranca/inclusao`, não altera a coleta de contratos, a atribuição de UG ou a publicação financeira.

**Interpretação pré-definida:** `http_404` significa resposta HTTP de recurso não encontrado e não é convertido em zero; `empty_complete` só existe após resposta válida com total de páginas igual a zero; `sample_complete` cobre apenas a única página declarada; `sample_incomplete` indica páginas adicionais não consultadas. Respostas inválidas ou indisponíveis mantêm status específico. Uma resposta sem filtro não autoriza atribuir instrumentos de outros órgãos ao IFC; as linhas nunca são armazenadas, exibidas ou ligadas a NE, NS ou OB.

O workflow `sondar-dados-oficiais.yml` executa a comparação **uma única vez após alteração do código** ou por disparo manual, sem cron novo nem Secrets. Os logs guardam somente datas escolhidas, escopo do filtro, status, páginas e contagem de registros. As datas são amostras técnicas, **não datas previamente comprovadas de inclusão de cobrança**. A integração de instrumentos de cobrança continua bloqueada até confirmação da disponibilidade, identidade dos vínculos e semântica dos eventos.

**Aceite técnico:** testes de construção de URL com e sem filtro, impossibilidade de consulta geral de contratos, resposta 200-vazia distinta de 404, limite de uma página e privacidade. **Aceite da fonte:** depende do resultado da execução real, sem extrapolação de cobertura ou valor financeiro.

## Evidência real do teste com e sem filtro — 23/11/2026

O [workflow #45241802339](https://github.com/guimig/observatorio-despesas/actions/runs/45241802339), com código da [PR #123](https://github.com/guimig/observatorio-despesas/pull/123), **concluiu tecnicamente** e produziu os resultados de acesso abaixo (cada amostra exigia só `pagina=1` e `tamanhoPagina=10`):

| Data de inclusão sondada | CNPJ Reitoria informado | Sem `cnpjOrgao` |
| --- | --- | --- |
| 15/10/2026 | `http_404` antes da primeira página | `http_404` antes da primeira página |
| 13/11/2026 | `http_404` antes da primeira página | `http_404` antes da primeira página |

**Inferência limitada:** a retirada do filtro institucional não resolveu o problema nessas duas datas. Isso afasta a hipótese de que *somente* o CNPJ do IFC produziu os retornos anteriores; não demonstra que o endpoint não exista, nem que não haja instrumentos cadastrados em outras datas, nem que zero documentos de cobrança tenham sido emitidos. Ainda não existe retorno válido (HTTP 200) de registros de cobrança, mesmo sem filtro de órgão. A especificação continua listada no OpenAPI oficial.

Na mesma execução, `GET /v1/contratos/atualizacao` apresentou `network_unavailable` em uma chamada amostral, após ter respondido com sucesso em execução anterior. Não há prova de falha persistente do coletor incremental; o workflow normal do Observatório mantém suas regras de falha/checkpoint. O Contratos.gov.br também permaneceu indisponível no executor, sem confirmação de autenticação ou cobertura.

**Próximo critério antes de integrar cobranças:** obter uma janela que contenha instrumento de cobrança comprovadamente publicado no PNCP, ou esclarecimento técnico oficial do comportamento da rota/status HTTP 404; só então testar um endpoint alternativo oficial com resposta verificável. Não repetir sondagens inconclusivas em cron nem ativar coletor de cobrança. A implementação financeira deve continuar concentrada nos documentos e históricos da CGU. Nenhuma consulta desta investigação alterou os JSONs de despesa, o catálogo PNCP, o checkpoint ou o site.

## Melhoria da atualização dinâmica CGU — 23/11/2026

A análise do acervo mensal em `main` identificou lacunas de enriquecimento documental mesmo onde as três fases da coleta estavam disponíveis: 2025-12 registra **559 documentos de pagamento, 60 com vínculos consultados**; 2026-10, **102 e 60**; 2026-11, **292 e 195**. Esses totais indicam quantidade de documentos e consultas de impacto, **não valores pagos** nem completude de um exercício inteiro. Dezesseis históricos de itens da competência 2026-11 estavam marcados como consultados sem data de reconsulta, legado que merece revisão.

A rotina `src/enrich-month.mjs` foi corrigida para tornar **históricos de itens originalmente vazios** elegíveis à revisão posterior. Históricos de notas de empenho de **exercícios anteriores** passam a ter janela de revisão de **7 dias**; os do exercício corrente, **14 dias** (antes, histórico com evento exigia 30 dias e histórico vazio nunca era reconsultado). Checkpoints ausentes ou inválidos são elegíveis, mas nenhum registro é marcado como verificado sem resposta CGU íntegra. O limite de duas reconsultas por rodada e o revezamento entre competências permanecem; não é criada nova base, nem há aumento irrestrito de consultas. Cada resposta completa atualiza a data de verificação; uma consulta incompleta ou resultado que suprimiria evento anterior continua sendo recusado pela camada de persistência, sem substituição silenciosa.

O novo comando `npm run audit:cgu-interannual` calcula, **somente a partir dos JSONs mensais canônicos**, contagens de NS/OB/DF ligadas a NEs de exercícios anteriores, tipos documentais, NEs com documento original ausente do **acervo local** e anos correspondentes, pendências de consulta de impactos, históricos de itens ainda não consultados e checkpoints sem data. Nenhum nome, NE integral, CPF, valor nem vínculo inferido é publicado; nota original ausente no acervo local **não significa inexistência na CGU ou no SIAFI**. A auditoria é executada também antes das consultas do workflow já existente de enriquecimento, sem novo agendamento.

**Aceite técnico:** testes de histórico inicial vazio, horizonte de sete dias da NE anterior, não reconsulta precoce, idempotência e proteção contra exclusão de eventos; teste de N:M interanual e ausência de documento original no acervo. **Aceite financeiro:** não aplicável; esses fatos não são saldo de restos a pagar e não alteram indicadores financeiros. Retorno/rollback por revert da PR, sem reescrever histórico ou adicionar dados de fonte não verificada.

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

Foi preparado o experimento **somente leitura** `src/probe-official-data.mjs` no workflow `sondar-dados-oficiais.yml`, disparado manualmente ou por alteração do próprio código. Ele consulta, sem token, **apenas as duas rotas públicas PNCP** de contratos/empenhos atualizados por data e instrumentos de cobrança inseridos. Janela móvel de 14 dias, filtrada pelo CNPJ publicador do IFC `10635424000186`, com **até duas páginas de cinco registros por rota**. Resultado com paginação remanescente fica `sample_incomplete`, nunca `complete`.

A sondagem compara somente identificadores PNCP `-2-` exatos com o catálogo já coletado e, quando existir campo explícito `numeroEmpenho` contendo a **NE SIAFI integral da UG 158459**, verifica presença da mesma identidade no conjunto canônico CGU. Sem número integral, a correspondência financeira permanece **não verificada**. Também conta publicações anteriores à janela de atualização, sem presumir que houve modificação contábil ou pagamento. O teste de instrumentos de cobrança mede apenas a presença de referências oficiais PNCP, não notas liquidadas nem saldos.

A indisponibilidade do OpenAPI do Contratos.gov.br será investigada com quatro consultas de acesso anônimo de baixo volume: página de documentação, JSON OpenAPI, tentativa de `GET /api/v1/empenho/rp` **sem parâmetros** apenas para identificar barreira HTTP, e `GET /api/contrato/ug/158459` apenas para constatar código de resposta; nenhum corpo de registros da UG é processado nem publicado. Uma resposta HTTP 400/422 à rota sem parâmetros **não comprova acesso funcional**; 401/403 demonstra exigência de autenticação na solicitação testada. Documentação técnica de terceiros sugere restrição JWT às rotas de período; a fonte oficial precisa confirmar.

Todos os retornos são limitados em memória, o diagnóstico descarta payloads e registra apenas categorias/contagens; nenhuma resposta pessoal, CNPJ de fornecedor, CPF, número de NE, valor monetário, JSON novo ou credencial será publicada. Limites e formato foram cobertos por testes unitários. Os resultados observados no runner devem ser adicionados abaixo após a execução, sem afirmar validação de uma fonte ainda não testada.

**Aceite técnico:** CI, workflow read-only real, observação da paginação, controle de sobreposição e garantia de sigilo. **Aceite de integração:** exige evidência de cobertura da UG financeira, NEs substitutivas e cronologia dos eventos, além de validação semântica de RP. Não habilitar indicadores nem alterar o coletor regular.

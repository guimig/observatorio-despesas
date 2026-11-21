# ARPs PNCP — primeira integracao incremental

O PNCP disponibiliza `GET /v1/orgaos/{cnpj}/compras/{anoCompra}/{sequencialCompra}/atas` para recuperar atas vinculadas a uma contratacao. A consulta usa exclusivamente IDs oficiais de compras marcadas `srp=true` no catalogo de licitacoes da Reitoria. Fonte: [Manual de Integracao PNCP v2.6, secao 12.5](https://pncp.gov.br/manual/pt-br/latest/ata_de_registro_de_preco/consultar_atas_de_registro_de_preco_por_compra.html).

## Modelo e limites

- Uma licitacao SRP pode ter zero ou varias atas. Uma ata pode nao gerar compra, contrato ou empenho.
- O arquivo `data/procurement/atas.json` guarda somente ID PNCP da compra, sequencial da ata, numero, datas de assinatura/vigencia/publicacao, cancelamento e permissao de adesao, quando presentes.
- Nao sao persistidos fornecedores pessoas fisicas, respostas brutas, documentos anexos, valores estimados ou quantidades inventadas.
- A primeira etapa **nao coleta itens, fornecedores, participantes, saldos de quantitativos ou contratações decorrentes**. Estes exigem endpoints e chaves de associacao especificos; nao inferir por processo, valor ou proximidade de datas.
- A UG 158459 **nao e inferida** a partir da publicacao centralizada da Reitoria.
- Consulta vazia completa e diferente de consulta falha; resultados anteriores so sao substituidos por resposta valida. Reconsulta de compras SRP apos 30 dias, ate 12 por execucao; consultas novas tem prioridade.
- Valores registrados em ARP nao sao valores empenhados, liquidados ou pagos. A ausencia de ata ou empenho no acervo nao prova irregularidade.

## Operacao

`npm run pncp-atas:plan` apresenta planejamento sem rede nem gravacao. `npm run collect:pncp-atas` consulta a API publica, limitado por `PNCP_ATA_LIMIT` (1 a 50). O workflow `coletar-atas-pncp.yml` executa em serie com as outras coletas, valida e publica apenas JSON minimizado. A interface lista a quantidade de atas vinculadas por ID PNCP, distinguindo consultas pendentes e vazias.

## Proximas etapas

Verificar amostras reais e eventual diferenca de formatos entre API de integracao e API de consulta; integrar itens, resultados, fornecedores PJ e orgaos participantes sem expor dados pessoais; modelar adesoes e contratações decorrentes com evidencia documental. Antes de criar indicador de saldo de ata, obter quantitativos registrados e efetivamente utilizados por item e unidade participante.

## Diagnóstico de cobertura da coleta

A rotina informa quantos procedimentos SRP estão catalogados, quantos foram consultados, quantos ainda não foram consultados e quantos tiveram consulta completa sem ata retornada. Erros são classificados por categoria HTTP/formato, sem registrar resposta bruta. **Consulta vazia não é irregularidade**; falha de consulta não equivale a resposta vazia. A execução real da API deve ser verificada no workflow antes de ampliar a coleta de itens ou fornecedores.

## Cobertura e respostas vazias (novembro de 2026)

A execução real identificou respostas PNCP sem atas com envelope `data: []`, `totalPaginas: 0`, `totalRegistros: 0`. Essa combinação indica consulta completa sem registros, não erro de paginação. Respostas contraditórias ou páginas parciais continuam rejeitadas. Para impedir que os mesmos procedimentos sem atas ocupem todas as vagas de coleta, a seleção diária aplica rotação determinística entre compras elegíveis; consultas completas, inclusive vazias, são revalidadas após 30 dias. A ausência de ata não é irregularidade nem ausência de empenho.

## Participacao administrativa em ARP — coleta incremental

A API PNCP de integracao (Manual v2.6, secao 12.16) permite consultar partes envolvidas em uma ata por GET em `/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/atas/{ata}/partesenvolvidas`. Os papeis sao gerenciadora (1), participante (2) e nao participante (3). Esta integracao salva **somente** os papeis em que os dados publicados coincidam simultaneamente com o CNPJ do Campus Araquari (10.635.424/0003-48) e com a unidade 158459. Nao atribui automaticamente ao campus atas publicadas pela Reitoria (CNPJ 10.635.424/0001-86, UG 158125).

O arquivo `data/procurement/ata-participants.json` registra o ID oficial da ata, a data da consulta completa e os papeis institucionais confirmados. Nao armazena nomes, CPFs, dados de fornecedores, documentos ou respostas brutas. A consulta e limitada a 12 atas por execucao, com revalidacao apos 30 dias. **Ausencia de correspondencia nao prova ausencia de participacao**: podem existir divergencias de cadastro, publicacao centralizada ou vinculos nao disponibilizados pela API. Nenhuma participacao significa, por si, compra efetiva, empenho ou pagamento.

O endpoint e o esquema foram documentados, mas a coleta real e a cobertura dependem do workflow automatizado. A publicacao no painel sera feita somente apos verificar os resultados reais e a semantica das unidades retornadas.

Fonte: [Manual PNCP, consultar partes envolvidas em ata](https://pncp.gov.br/manual/pt-br/latest/ata_de_registro_de_preco/consultar_partes_envolvidas_em_ata_de_registro_de_preco.html).

### Cobertura distribuída das partes envolvidas

A primeira execução consultou 12 atas de uma única licitação, sem encontrar correspondência simultânea de CNPJ e UG. Para evitar que uma compra com muitas atas monopolize a verificação, o planejamento agora intercala atas de compras diferentes (uma por compra a cada rodada), sem deixar de revalidar as já consultadas após 30 dias. O agendamento executa até 30 consultas por dia útil, respeitando a serialização das coletas. Resultados sem correspondência são evidência insuficiente para atribuição, **não prova de ausência de participação**. O catálogo de participações permanece separado dos dados públicos do painel até validação semântica da API.

### Auditoria do formato real das partes envolvidas

Como as primeiras consultas completas não identificaram a combinação CNPJ/UG do Campus, a coleta registra **somente contagens agregadas em logs efêmeros**: quantidade de linhas, presença de campos de órgão, unidade e papel, e quantas correspondências ocorreram por CNPJ, por UG e simultaneamente. Não imprime CNPJ, CPF, nomes, registros brutos ou valores de fornecedores. Esses diagnósticos não entram no JSON público. A interpretação de uma correspondência depende da estrutura efetivamente publicada pelo PNCP; ausência de correspondência não comprova ausência de participação. A etapa seguinte é validar a semântica dos campos e, somente depois, publicar vínculos confirmados no painel.

## Correção metodológica: órgão publicador, unidade PNCP e UG SIAFI

A licitação e a ata podem ser publicadas pela Reitoria (CNPJ 10.635.424/0001-86, UG SIAFI 158125), inclusive quando diversos campi sejam destinatários potenciais. O CNPJ do órgão gerenciador e a UG de emissão de empenho são dimensões distintas. O campo `unidade.codigo` da API PNCP identifica uma unidade administrativa no contexto do PNCP; **não se deve pressupor que seja igual à UG SIAFI 158459**. A correspondência só pode ser declarada confirmada após documentar um mapeamento oficial entre identificadores. Quando houver apenas CNPJ do campus com papel válido, a resposta é candidata à verificação, não vínculo confirmado. O diagnóstico preserva as contagens, não os registros brutos.

As quantidades globais da ata, quando publicadas, representam o escopo do registro de preços e **não podem ser atribuídas integralmente ao Campus Araquari**. Quantitativos por participante exigem fonte específica de distribuição por órgão/unidade e item; consumo efetivo exige documentos de contratação e empenho. Não estimar saldo de ata como quantitativo registrado menos empenhos sem reconciliação por item e unidade.

**Evidência observada em 21/11/2026:** em lote de 65 partes envolvidas, 60 continham CNPJ e unidade da Reitoria e 5 pertenciam a outras unidades/órgãos; nenhum apresentava CNPJ ou UG SIAFI de Araquari nos campos então examinados. Isso sustenta predominância de publicação centralizada na amostra, mas não prova inexistência de participações ou atas próprias no histórico completo.

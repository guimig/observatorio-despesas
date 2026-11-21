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

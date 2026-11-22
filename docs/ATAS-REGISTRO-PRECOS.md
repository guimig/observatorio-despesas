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

## Auditoria de itens e quantitativos por participante

Antes de coletar valores ou quantitativos, o workflow `auditar-detalhes-arp.yml` consulta amostra pequena de detalhes de atas em compras distintas, sem armazenar nem imprimir respostas brutas. O resultado registra somente presença de campos estruturais, sucesso e falhas. **Presença de quantidade total, itens ou fornecedores no detalhe não comprova distribuição por participante**. Se a API não disponibilizar a distribuição de quantitativos por órgão/unidade e item, ela será tratada como informação indisponível; não atribuir os quantitativos globais ao Campus nem estimar a partir de empenhos. O endpoint de detalhe precisa ser validado na execução real antes de qualquer expansão.

## Decisao de escopo: quantitativos institucionais, nao distribuicao interna

**Decisao metodologica de 21/11/2026.** Suspender a investigacao automatizada da distribuicao interna de quantidades por campus em editais, anexos, imagens e PDFs. A informacao podera existir apenas em documentos administrativos nao estruturados e demandara verificacao humana. Nao automatizar OCR, extracao de tabelas ou interpretacao de imagens nesta fase.

Priorizar fontes estruturadas e dados verificaveis por **item e procedimento**, com origem, data e escopo:
- **Quantidade licitada:** prevista no procedimento; nao implica contratacao.
- **Quantidade registrada:** efetivamente consignada na ata; pode diferir da licitada.
- **Saldo para adesoes:** quando publicado por sistema de gestao de atas, e especifico da adesao; **nao equivale** ao saldo contratavel pela gerenciadora ou por Araquari.
- **Saldo contratavel institucional:** exibir apenas quando a fonte identificar inequivocamente esse saldo, o item, a data e o escopo. Nao calcular por subtracao simples de empenhos.
- **Quantidade reservada a Araquari:** nao apurada automaticamente; indicar 'Verificacao documental necessaria' somente quando a consulta realmente exigir essa informacao.

Os registros quantitativos futuros devem passar por `src/arp-quantity-policy.mjs`, com tipologia, origem e data verificaveis. O modulo nao inventa quantidades e nao coleta dados. O PNCP pode publicar a ata e suas condicoes sem detalhar a distribuicao administrativa interna. Os itens/fornecedores so devem ser incorporados depois de verificar endpoints oficiais e a granularidade efetivamente retornada.

A prioridade de integracao seguinte e cruzar licitacoes e atas institucionais com contratos formais e empenhos de Araquari **somente por vinculos documentais verificaveis**. Uma licitacao SRP pode nao resultar em nenhuma contratacao ou empenho.

## Fonte estruturada de itens das licitacoes PNCP

A consulta oficial de itens da compra PNCP usa `/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens`. Diferentemente do detalhe da **ata**, ela permite investigar itens licitados e seus quantitativos. A auditoria `auditar-itens-pncp.yml` testa ate cinco procedimentos SRP distintos e registra somente contagens de campos, quantidade de linhas e presenca de paginacao. Nao armazena valores, fornecedores ou descricoes. A existencia do campo `quantidade` **nao prova** que a quantidade seja registrada em ata ou esteja disponivel para contratacao; e quantidade do item da licitacao. A coleta completa dependera de validacao de formato, paginacao e regras de atribuicao institucional, sem rateio interno por campus.

### Coleta incremental dos itens licitados

O coletor `collect:pncp-tender-items` consulta ate tres licitacoes SRP por execucao, com paginacao completa, validacao dos numeros de item, descricao sanitizada e quantidade numerica. Os dados sao gravados em `data/procurement/tender-items.json` apenas apos completar todas as paginas do procedimento. Falhas descartam a licitacao inteira; nenhuma pagina parcial e publicada. Cada item conserva o ID PNCP de origem e o escopo `ifc_tendered`: **quantidade licitada institucional**, nunca quantidade registrada na ata, saldo disponivel ou reserva de Araquari. O catalogo e validado contra as licitacoes cadastradas e pode ser ampliado sem OCR ou rateio interno. A integracao visual dos itens fica para etapa posterior de verificacao da cobertura e usabilidade.

### Consulta dos itens licitados no painel

O explorador recolhível em Licitações carrega sob demanda o catálogo de itens PNCP validado no build estático. Permite filtrar por descrição, item ou ID PNCP e por procedimento, com paginação de 25 linhas, quantidade licitada institucional e data da coleta. A cobertura informa quantas licitações SRP possuem itens coletados; ausência de item não equivale a quantidade zero nem a ausência de contratação. Não exibe saldo de ata nem reserva de Araquari.

### Ampliação progressiva e tratamento de falhas (novembro de 2026)

O agendamento coleta até cinco licitações SRP pendentes por execução, em vez de três. A seleção usa rotação diária determinística sobre os procedimentos ainda não coletados, de modo que uma licitação com falha repetida não impeça indefinidamente o avanço para outras. Procedimentos bem-sucedidos são preservados; os que falham continuam elegíveis em rodadas posteriores. A seleção não prova completude histórica: a cobertura depende da abrangência do catálogo de licitações, da disponibilidade do endpoint e do sucesso das consultas. Nenhum quantitativo é somado entre itens de unidades de medida diferentes.

### Vinculos documentais com despesas de Araquari

Na tabela de licitacoes, a coluna de instrumentos decorrentes passa a indicar separadamente: (1) NEs da UG 158459 confrontadas entre documentos CGU carregados e referencias do instrumento PNCP; (2) instrumentos com referencia de NE 158459 declarada no PNCP, ainda sem conferencia com documento CGU carregado; (3) instrumentos com indícios administrativos, como processo SIPAC 23349, sem confirmacao de despesa. A contagem de NEs elimina duplicacoes do mesmo identificador. A ausencia de vinculo nao prova inexistencia de contratacao. Nenhuma das contagens representa quantidade adquirida por item, valor empenhado, saldo de ata ou obrigacao de contratar.

### Consulta das evidencias por instrumento

A tabela de licitacoes apresenta a opcao recolhivel **Ver evidencias documentais** para cada licitacao com instrumentos PNCP vinculados. Exibe o identificador do instrumento, a classificacao da evidencia e, quando conferida contra documento CGU da UG 158459 carregado, a NE integral. A lista nao faz consulta remota adicional e sua cobertura depende dos documentos CGU ja carregados na sessao. Ausencia de evidencia nao significa inexistencia de despesa. A informacao e uma relacao documental, nao uma atribuicao de quantidades de itens.

### Conferencia historica de NEs sob demanda

O botao **Conferir NEs em todas as competencias** consulta, apenas quando acionado, os JSONs mensais publicos listados no manifesto da UG 158459 e ainda nao carregados no navegador. Cada competencia e validada antes de entrar no cache; arquivos indisponiveis sao contabilizados sem inventar resultados. A competencia financeira exibida no dashboard permanece inalterada. Apos a carga, os vinculos de licitacoes e contratos sao recalculados com o conjunto de documentos disponiveis. O carregamento nao acessa APIs autenticadas, nao produz novos dados, nao comprova inexistencia de despesa e pode consumir rede/memoria em acervos historicos grandes. O controle manual evita custo de carregamento inicial.

# Modelo conceitual das contratações e da execução de despesas

Status: revisão técnica 2026-11-19. **Este documento não constitui parecer jurídico ou contábil.** O conteúdo distingue **regra normativa**, **capacidade de consulta disponível**, **modelo implementado** e **relações ainda não verificadas**. Órgão publicador IFC: UASG **158125**; UG financeira Araquari: **158459**; prefixo SIPAC de processos do campus: **23349** (indício secundário, digitado manualmente).

## 1. Legislação e natureza do instrumento

Lei nº 14.133/2021, art. 95: regra geral é instrumento de contrato; há hipóteses legais em que se pode substituí-lo por carta-contrato, nota de empenho, autorização de compra ou ordem de execução de serviço (dispensa por valor e compra com entrega integral e imediata sem obrigações futuras). Portanto **obrigação contratual não exige sempre um "Termo de Contrato" autônomo**, e a NE *não se torna* um contrato formal por aparecer no PNCP.

O PNCP chama oficialmente seu conjunto de publicações de **"Contratos/Empenhos"** e retorna \`tipoContrato.nome\`. O cadastro local de novembro de 2026 contém, precisamente, **9 registros "Contrato (termo inicial)" e 61 registros "Empenho"**, de 70 instrumentos PNCP. A tabela de **contratos formais** exibe somente a primeira categoria. As NEs substitutivas ficam **fora** dessa tabela, ainda que preservadas no catálogo de origem para rastreabilidade. A visualização do gasto é feita pela CGU, sem somar novamente os valores de publicação PNCP. Instrumento com tipo desconhecido fica fora da tabela formal até validação, sem presunção de natureza.

Importante: uma contratação pode gerar 0, 1 ou vários termos de contrato; um termo pode envolver 0 ou vários empenhos segundo estágio, exercício e forma de execução. A exigência de prévio empenho da despesa (Lei nº 4.320/1964, art. 60) não significa que, no momento da publicação de um termo, já exista NE cadastrada no PNCP, ou que tenha obrigatoriamente sido emitida na UG 158459 em toda contratação centralizada. **Não interpretar "NE não recuperada" como "contrato sem empenho" ou irregularidade.**

## 2. Fluxos e cardinalidades a serem modelados

| Origem | Destino | Cardinalidade observável | Evidência exigida |
| --- | --- | --- | --- |
| Publicação PNCP (licitação, dispensa, inexigibilidade) | Contratos formais | 0:N | \`numeroControlePncpCompra\` do detalhe do contrato |
| Publicação PNCP | Instrumentos substitutivos (NE, ordem, autorização) | 0:N | ID PNCP de origem **e tipo de instrumento** |
| Publicação PNCP sob SRP | Ata(s) de Registro de Preços | 0:N | identificador próprio de ata, via API PNCP |
| Publicação PNCP | Itens | 0:N | ID da contratação + número sequencial do item |
| Itens | Resultado(s)/fornecedor(es) | 0:N | ID da contratação + sequência + ID do resultado/fornecedor |
| Ata | Item registrado/fornecedor | N:M quando considerados diversos instrumentos e itens | tabela de associação de ata, item, fornecedor/resultado e quantitativo; **não presumir 1 fornecedor por ata sem verificar modelo da fonte** |
| Ata | Contratação decorrente (termo ou equivalente) | 0:N | referência explícita à ata, contrato ou empenho |
| Contrato formal | Nota(s) de empenho (NE) | 0:N no acervo, 1:N ao longo da execução quando há dotação e atos | vínculo oficial SIAFI/PNCP/Contratos.gov; somente processo igual é indício |
| NE | Registro(s) de liquidação | 0:N | CGU \`/empenhos-impactados?fase=2\` |
| Registro de liquidação (NS e outras espécies) | NEs impactadas | 0:N | CGU \`/empenhos-impactados\`, **uma NS pode atingir mais de uma NE** |
| NE | Documento(s) da fase de pagamento | 0:N | CGU \`/empenhos-impactados?fase=3\` |
| Documento da fase de pagamento (OB, DF etc.) | NEs impactadas | 0:N | CGU \`/empenhos-impactados?fase=3\` |
| Registro da liquidação | Documento de pagamento | N:M **possível**, mas ainda não afirmado documentalmente | só registrar após consulta oficial de \`/documentos-relacionados\`; não inferir por valor/data |

Cardinalidade de cadastro **não** equivale a existência garantida de registros. Uma ata não obriga a Administração a contratar (Lei nº 14.133/2021, art. 83). Sua vigência é de um ano, prorrogável por igual período se comprovada a vantajosidade (art. 84). A ata não é termo de contrato, NE ou despesa executada. **Uma licitação SRP pode produzir ata sem gerar qualquer empenho**, e não deve ser sinalizada como pendência financeira por isso. O processo de aquisição pode gerar vários empenhos, notas de pagamento e operações de correção. Do ponto de vista dos dados, cada nó e vínculo precisa de ID, fonte, data de referência, grau de evidência e cobertura de consulta.

Representação resumida:

\`\`\`text
Licitação / Dispensa / Inexigibilidade (PNCP -1-)
  ├─ itens ─ resultados ─ fornecedores
  ├─ 0..N ARPs ─ itens registrados / fornecedores
  ├─ 0..N contratos formais (PNCP -2-; espécie "Contrato")
  │     └─ 0..N NEs SIAFI (por UG e exercício)
  └─ 0..N instrumentos equivalentes ("Empenho" etc.)
        └─ NE SIAFI *somente quando a identidade financeira for comprovada*

NE SIAFI 158459 + gestão + ano + espécie + sequência
  ⇄ N vínculos explícitos com documentos de liquidação (NS, NL ...)
  ⇄ N vínculos explícitos com documentos da fase de pagamento (OB, DF ...)
Liquidação ⇄ pagamento: relacionamento independente, não deduzido por proximidade.
\`\`\`

## 3. Documentos orçamentários e financeiros

A Lei nº 4.320/1964, arts. 58–65, distingue empenho, liquidação e pagamento. A NE documenta o ato de empenhar; a liquidação verifica o direito do credor e o pagamento tem seu próprio processamento. O SIAFI gera **espécies** documentais que não se confundem com essas **fases**: NE (nota de empenho); NS (nota de sistema); NL (nota de lançamento); OB (ordem bancária); DF (documento de arrecadação federal, DARF), DR, GR, entre outras. Uma NS pode ter finalidade contábil distinta; apenas se a CGU a classificou na fase 2 ela integra a extração de liquidação correspondente. Sigla, por si só, não demonstra quitação, espécie de retenção, estorno ou regularidade.

A CGU oferece três conjuntos de fase na API \`/despesas/documentos\`, além de \`/documentos/{codigo}\`, \`/documentos-relacionados\`, \`/empenhos-impactados\`, \`/itens-de-empenho\` e \`/itens-de-empenho/historico\`. A versão atual do Observatório coleta com token \`CGU_API_KEY\` no GitHub Actions e mantém documento público mínimo \`{id,date,phase,cents,...}\`. O documento SIAFI é identificado por **UG + gestão + ano + sigla + sequência**. Mesmo \`2026NE000266\` em um PNCP centralizado **não prova** a UG emissora sem a UG identificada no registro ou associação oficial.

## 4. Estornos, anulações, reforços, cancelamentos e saldos

Documentos e itens podem ter eventos de **emissão original, reforço, anulação parcial/total, cancelamento de restos a pagar, retificação** e outras movimentações contabilmente relevantes. Não basta somar \`valor\` de documentos da mesma fase ou considerar \`valorAtual\` um saldo financeiro histórico. Uma NE inicial pode sofrer reforços e anulações; o registro atual e o evento histórico têm semânticas diferentes. Também existem retenções, pagamentos de restos a pagar e documentos negativos/estornados.

Especificação para próxima fase:
- **Movimento:** registrar tipo de operação somente quando a fonte fornecer campo/ação confiável; jamais inferir \`cancelado\` pelo nome ou por valor zero.
- **Referência:** quando houver, manter ID do documento original alterado e identificador do evento corretivo.
- **Valor:** diferenciar \`valorOriginal\`, \`valorAtual\`, \`valorMovimento\`, \`valorAnulado\` e \`saldo\` conforme a documentação de cada endpoint; **não criar um valor líquido sem reconstrução auditável**.
- **Situação:** \`não verificada\`, \`confirmada\`, \`parcial\`, \`indisponível\` devem representar **cobertura da consulta**, não situação jurídica/contábil do documento.
- **Restos a pagar:** não confundir exercício do documento originário com exercício do pagamento.
- **Pagamento:** documento da fase 3 não significa que seu favorecido seja necessariamente o fornecedor principal; há recolhimentos tributários, listas de credores e deduções.

O histórico de operações de itens de empenho da CGU fornece uma via para examinar reforço e anulação (com detalhes de valor, quantidade e operação). O estado contábil integral exige leitura adequada das macrofunções do Manual SIAFI, e eventual conciliação com movimentações SIAFI; nem todos os campos estão necessariamente disponíveis via CGU.

## 5. Critérios de atribuição do Campus Araquari

1. **Confirmação:** NE SIAFI integral da UG 158459, oficialmente vinculada ao instrumento, ou UG 158459 + número abreviado confrontado com documento integral CGU.
2. **Indício financeiro:** UG 158459 e NE abreviada sem validação do documento integral.
3. **Correspondência contextual:** processo e CNPJ PJ do fornecedor coincidentes, sem elo financeiro oficial.
4. **Indício administrativo:** processo que começa por \`23349\`, digitado manualmente; a origem pode ser excepcionalmente centralizada em outro processo.
5. **Sem atribuição:** publicação sob Reitoria/UASG 158125 não demonstra campus. Não converter ausência de evidência em certeza negativa.

Um **contrato formal** de Araquari pode não constar da janela CGU disponível, porque a consulta histórica ainda está em preenchimento ou a NE ainda não consta na origem consultada. A tela padrão mostra candidatos identificáveis, com filtro de consulta institucional, mas **não chama empenhos substitutivos de contratos formais**.

## 6. Fontes e limites de validação

- [Lei nº 14.133/2021 — arts. 82–86, 89–95](https://www2.camara.leg.br/legin/fed/lei/2021/lei-14133-1-abril-2021-791222-normaatualizada-pl.html) (inclusive distinção entre termo e instrumento hábil).
- [Lei nº 4.320/1964 — arts. 58–65](https://www2.camara.leg.br/legin/fed/lei/1960-1969/lei-4320-17-marco-1964-376590-normaatualizada-pl.html).
- [Manual de Integração PNCP 2.6](https://pncp.gov.br/manual/pt-br/latest/singlehtml/) — contratos/empenhos, NEs vinculadas, atas, itens, resultados e arquivos.
- [API oficial do Portal da Transparência / CGU](https://api.portaldatransparencia.gov.br/swagger-ui/index.html) — documentos, impactos, documentos relacionados e histórico de itens.
- [Manual SIAFI / Tesouro Nacional](https://manualsiafi.tesouro.gov.br/) — macrofunções contábeis e financeira, a verificar por procedimento específico. **O portal do manual não esteve acessível automaticamente nesta revisão; não declarar leitura integral das macrofunções.**
- [STN — migração do Empenho Web](https://www.gov.br/tesouronacional/pt-br/noticias/nota-de-empenho-sera-implantada-na-plataforma-siafi-web-a-partir-de-4-de-janeiro).

**Terminologia dos serviços:** a chave configurada é \`CGU_API_KEY\` do **Portal da Transparência**, não uma chave da AGU (Advocacia-Geral da União). A AGU é fonte normativa/modelos jurídicos; a CGU é a fonte da API de despesas já utilizada por \`collect-cgu.mjs\`. A API pública de consulta PNCP não usa o Secret CGU, mas ela também é uma API oficial.

## 7. Sequência recomendada

**Implementado nesta revisão:** tabela exclusiva de contratos formais; tipos documentais SIAFI exibidos sem presumir situação; classificação de NEs substitutivas e vínculos por ID PNCP preservados; nenhuma duplicação nos somatórios.

**Próximas integrações dependentes de evidência:** (1) consultar \`/documentos-relacionados\` e \`/empenhos-impactados\` via Secret CGU para TODAS as NS selecionadas, mesmo quando o valor já está presente; (2) consultar amostras do histórico de itens e caracterizar operações de anulação/reforço; (3) integrar ARPs PNCP com itens e fornecedores e vinculação a instrumentos formais/equivalentes; (4) modelar vínculos documentais N:M e versões por documento; (5) ampliar a cobertura financeira e reconciliar movimentos apenas após classificação confiável dos eventos.


## Inspeção autenticada do esquema CGU (etapa experimental somente leitura)

Criados `src/inspect-cgu-siafi.mjs` e `.github/workflows/diagnosticar-cgu-siafi.yml`. Selecionam uma amostra local de NE com item, NS com múltiplos vínculos confirmados e documentos OB/DF para consultar a **API CGU de despesas com `secrets.CGU_API_KEY`**, somente no runner do GitHub Actions. A saída contém **somente nomes/tipos de campos e contagens agregadas**; não publica identificadores, valores, documentos brutos nem resultados pessoais. A inspeção deve determinar se o esquema disponibiliza semântica suficiente para estorno/anulação/reversão e qual vínculo é retornado por `documentos-relacionados`. **Nenhuma classificação de cancelamento é adicionada aos JSONs antes dessa verificação.**


## Incremento: vínculos de liquidações com empenhos (CGU)

O enriquecimento incremental autenticado (`src/enrich-month.mjs` e
`.github/workflows/enriquecer-cgu.yml`) passa a consultar
`/despesas/empenhos-impactados?fase=2` para cada documento de liquidação ainda
pendente, **mesmo quando o valor nominal já foi obtido**. A relação documental é
N:M: uma NS pode impactar várias NEs e seus subitens, e cada NE pode ser
impactada por várias NS.

Os vínculos são agrupados pela chave SIAFI completa do empenho e podem ter
valores negativos. O valor documental não é substituído automaticamente pela
soma dos impactos. Só após paginação integral e válida a NS recebe
`liquidationLinksChecked: true`. Uma resposta vazia significa consulta
concluída sem impactos retornados — não prova inexistência da obrigação.
Respostas repetidas, truncadas ou inconsistentes não alteram o acervo.

Uma recaptura com valor inalterado preserva o estado e os vínculos; a retificação
de valor reabre a necessidade de consulta. Vínculos preexistentes não podem ser
apagados somente porque uma nova consulta retornou vazia. O lote é limitado por
`ENRICH_LIQUIDATIONS` (padrão 12) e usa exclusivamente a secret
`CGU_API_KEY` no ambiente do GitHub Actions. A interface exibe se a consulta de
vínculos foi concluída, distinguindo-a da presença de relações financeiras.

## Observação de documento em múltiplos filtros de fase da CGU (novembro de 2026)

A apuração histórica da UG 158459 identificou o **mesmo identificador integral SIAFI** nos resultados de duas consultas `/despesas/documentos` realizadas com parâmetros `fase=2` e `fase=3` para a mesma data. Na execução de 22/11/2026, houve um caso em 08/12/2025 e dois casos em 10/12/2025. A duplicidade é de **aparição no resultado da consulta**, não evidência de dois documentos, duas obrigações ou duas operações distintas. A causa contábil/semântica da classificação ainda exige amostragem e documentação oficial.

O JSON mensal conserva **um único registro em `documents[]`**, com `id` SIAFI, `date`, `phase` original do primeiro filtro coletado e `cents`. Atributo opcional `phaseObservations[]` registra somente uma observação adicional `{id,date,phase,amountKnown,amountRelation}`. `phase` designa o *filtro de origem do resultado*, não uma nova etapa financeira comprovada. `amountRelation` indica apenas se o valor informado nessa consulta é igual, diferente ou inconclusivo em relação ao registro canônico, sem divulgar ou acumular o valor adicional. Não se duplica documento, fornecedor, vínculo, liquidação nem pagamento.

- Cobertura `coverage[].count` representa **ocorrências retornadas por fase** (`documents` canônicos nessa fase + observações adicionais); não representa quantidade de documentos únicos da UG.
- `phaseObservations` é compatível com arquivos antigos sem o campo; a validação rejeita órfãos, fase igual à canônica, observações duplicadas e contagem divergente. IDs encontrados em **datas diferentes** continuam bloqueados para revisão.
- A interface e a auditoria exibem aparições adicionais, mas **não somam os respectivos valores** e suspendem o total monetário conclusivo das fases afetadas por sobreposição. Uma retificação no valor canônico invalida a comparação anterior de valores.
- Atribuição de NS a pagamento, vínculo NS→OB/DF, liquidação efetiva e conciliação SIAFI continuam **pendentes** de evidência oficial. A duplicidade do filtro não autoriza inferir que um valor foi pago.

Essa é uma evolução compatível do **schema 1**, sem reescrever registros antigos, criar um banco de dados ou reconstruir valores financeiros. Antes de divulgar totais globais de fases sobrepostas, validar amostras com a fonte e a unidade contábil.

## Evolução da extração de textos e itens SIAFI — 22/11/2026

Caso de homologação: impressão completa da **NE 158459264222026NE000288**, emissão em 18/11/2026, versão 002 alterada em 19/11/2026, total R$ 794,85. O SIAFI informa subelemento 11 (Material Químico) e quatro linhas: seq. 001/compra 00006 (acetato de etila, 10 × R$ 30,00, R$ 300,00), 002/00008 (acetona, 5 × R$ 30,00, R$ 150,00), 003/00142 (éter dietílico, 2 × R$ 100,00, R$ 200,00), 004/00157 (hexano, 5 × R$ 28,97, R$ 144,85). A captura antiga omitia descrições extensas (limite 260 caracteres), misturava o número de item da compra na descrição, e não coletava quantidade/preço unitário/histórico.

O modelo mensal, ainda compatível com schema 1, admite `itemsDetailVersion:2` no documento NE, `purchaseItem` no item (sequencial da contratação extraído **somente quando o texto oficial declara "Item compra: 00000 -"**), `description` de até 5.000 caracteres após sanitização e `historyChecked:true` acompanhado por `movements[]`. Cada movimento contém `date` da operação, `operation` oficial, `type` apenas classificatório, `quantity` e `unitPrice` como strings decimais de precisão preservada e `cents` para o valor da operação; nada é agregado como saldo histórico. `itemsByDocument` continua agrupável por código/descrição de subelemento, permitindo diferentes subelementos na mesma NE.

O endpoint `/despesas/itens-de-empenho/historico` é consultado separadamente para cada sequencial, por lotes limitados e páginas verificadas, com checkpoint idempotente por item. Retorno incompleto ou não validado **não marca consulta concluída**. NEs já enriquecidas na versão antiga são reconsultadas, sem descarte dos dados anteriores até a nova coleta integral; históricos anteriores são preservados quando o item mantém o mesmo valor atual. Exemplo de versão alterada da impressão SIAFI não comprova reforço ou anulação: a classificação de `reinforcement` / `annulment` só se apoia no campo `operacao` do histórico CGU e não infere saldo contábil.

O campo narrativo sanitizado `description`, antes restrito a NE, passa a ser aceito para todas as espécies retornadas nos filtros CGU, incluindo NS/OB/DF, quando existir; textos com indício de dados sensíveis são omitidos e não registrados. A rotina histórica preexistente de reconsulta de descrição das NEs deve ser estendida separadamente para NS/OB/DF quando houver datas comprovadas, respeitando limites da API e as consultas integrais já efetuadas. A ficha exibe descrições somente no detalhe e abre com rolagem no início; os movimentos de cada item são recolhíveis.

**Limite de verificação:** o PDF da NE serve como referência comparativa, não como origem para alterar o JSON automático. A confirmação dos quatro códigos de compra, quatro descrições, quantidades e unidades no acervo depende da recuperação autenticada dos endpoints CGU e da cobertura de histórico; divergência permanece explicitada, nunca corrigida manualmente com números de anexo.

## Conferência documental dos movimentos de itens (22/11/2026)

A nova ficha distingue **conferência documental** de **conciliação contábil**. A função pura `assets/siafi-movement-audit.js` analisa somente movimentos coletados, verificando a cobertura (itens com `historyChecked`), a soma dos **valores atuais informados** dos itens diante do valor documental da NE e, quando todos os históricos contêm uma única `INCLUSAO`, a coincidência da data de inclusão e valor por sequencial. A implementação não altera os valores da fonte e não produz um saldo líquido.

Estados possíveis: `unavailable` (itens não consultados), `partial` (pelo menos um histórico ainda pendente), `no_movement_evidence` (consulta concluída sem movimento retornado), `original_only_consistent` (coincidência dos dados documentais originais), `additional_operations` (reforço, anulação ou outra operação identificada), `requires_review` (divergência de dados ou insuficiência para atestar inclusão única) e `no_items`. A expressão *consistente* não é sinônimo de saldo contábil conciliado e não comprova inexistência de pagamentos ou restos a pagar.

As datas e valores de operações adicionais permanecem como evidências individuais; não se adota sinal positivo/negativo de reforço/anulação sem validar a semântica oficial, tampouco se soma pagamento ou ARP PNCP como despesa da NE. A [issue #29](https://github.com/guimig/observatorio-despesas/issues/29) continua aberta para conciliação contábil, restos a pagar, versionamento/retificação dos movimentos e auditoria de operações reais complexas.

## Homologação aritmética de reforços e anulações (amostras reais CGU — 22/11/2026)

O acervo publicado `data/months/2026-11.json` contém quatro NEs cujos históricos de itens registram reforços e/ou anulações, com conferência aritmética do valor atual. Uma função pura em `assets/siafi-movement-reconciliation.js` reconstrói **valor atual dos itens a partir de movimentos oficiais**, usando `INCLUSAO + REFORCO - ANULACAO` somente quando todas as seguintes condições estão comprovadas: todos os sequenciais com histórico completo, exatamente uma inclusão original por item, campos de data e valor válidos, operações com semântica reconhecida, valores monetários positivos informados pela fonte e sequência que não resulta em total negativo. Operações de cancelamento, estorno, outras ou tipo desconhecido não têm sinal presumido: a reconstrução fica indisponível. O total reconstruído deve coincidir com o `valorAtual` dos itens; a soma destes deve coincidir com o valor documental quando disponível. Valores divergentes permanecem **divergentes**, não são ajustados.

Amostras da UG 158459, em **reais**, já registradas na CGU e inseridas como teste de regressão (nomes de fornecedores e processos não são utilizados):

| NE 2026 | Primeira inclusão identificada | Base da inclusão | Reforços | Anulações | Valor reconstruído | Valor atual CGU |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 000005 | 16/01/2026 | R$ 200.000,00 | R$ 789.998,93 | R$ 395.088,41 | R$ 594.910,52 | R$ 594.910,52 |
| 000216 | 10/07/2026 | R$ 28.000,00 | R$ 1.700,00 | R$ 0,00 | R$ 29.700,00 | R$ 29.700,00 |
| 000258 | 07/10/2026 | R$ 36.125,00 | R$ 37.175,00 | R$ 0,00 | R$ 73.300,00 | R$ 73.300,00 |
| 000281 | 11/11/2026 | R$ 400,00 | R$ 2.500,00 | R$ 0,00 | R$ 2.900,00 | R$ 2.900,00 |

**Atenção à cronologia:** o campo `date` do acervo é a data retornada no filtro de listagem CGU (nos exemplos, datas de novembro), e **não é prova independente de emissão original da NE**. A primeira inclusão foi obtida do recurso de histórico dos itens, e é identificada como *primeira inclusão no histórico consultado*, não como a emissão documental formalmente comprovada; a conferência da capa/versão SIAFI continua pendente.

**Limites:** os montantes acima são reconstrução documental de `valorAtual` de itens, não saldo de dotação, saldo de empenho a liquidar, saldo a pagar, valor pago, restos a pagar ou saldo financeiro/contábil. Não deve haver soma direta com importâncias de PNCP, liquidações ou pagamentos. Falhas de cobertura ou divergência bloqueiam a reconstrução. O histórico do Git conserva versões de JSON, sem respostas brutas adicionais; a interface mostra esses valores apenas na ficha detalhada de empenho, junto ao alerta de limitação. A issue #29 permanece aberta para conciliação dos saldos e eventos de restos a pagar.

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

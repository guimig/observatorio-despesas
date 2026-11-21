# AUD-05 — Atribuição de contratos e licitações ao IFC Araquari

Status: regras inspecionadas e cobertas por testes de regressão; **não é conciliação completa dos registros reais**.

## Identificadores e limites

| Identificador | Significado | Prova de despesa da UG 158459? |
| --- | --- | --- |
| UG SIAFI 158459 | Unidade executora Araquari | Sim, quando vinculada a documento oficial de execução |
| UASG 158125 / CNPJ da Reitoria | Publicadora centralizada do IFC | Não |
| CNPJ 10635424000348 | Publicação pelo campus | Não prova execução orçamentária |
| Processo SIPAC prefixo 23349 | Processo associado a Araquari | Indício, sujeito a conferência |
| ID PNCP do contrato (sufixo -2-) | Identificador do instrumento | Não |
| ID PNCP da contratação (sufixo -1-) | Identificador da licitação/compra | Não |
| Campo oficial numeroControlePncpCompra | Vínculo expresso contrato → contratação | Comprova relação entre registros, não beneficiário |
| NE completa da UG 158459 no vínculo PNCP | Referência documental à execução da UG | Evidência confirmada de atribuição, ainda sujeita à integridade da fonte |
| Processo + CNPJ de fornecedor coincidentes | Correlação contextual | Não |

## Níveis da atribuição

- **confirmed**: NE integral da UG declarada em vínculo oficial, ou coincidência verificável com documento CGU conforme regras implementadas.
- **ne_indication**: UG e número curto da NE informados, sem documento CGU suficiente para confirmar.
- **context / process_indication**: processo e/ou fornecedor coincidentes, sem prova documental de execução.
- **unverified**: nenhuma evidência suficiente.

A categoria `confirmed` comprova **atribuição documental à UG**, não o valor efetivamente executado, a vigência ou a existência de saldo contratual. Na implementação atual, a categoria `confirmed` para licitações decorre de evidência financeira vinculada a um instrumento. **Isso não significa que a licitação precise de empenho para existir ou para pertencer administrativamente ao Campus.** Uma licitação pode ser de Araquari por evidência administrativa independente (por exemplo, processo ou unidade demandante documentados), mesmo sem contratação posterior. A origem administrativa ainda precisa de classificação independente da execução financeira.

## Testes adicionados

`test/audit-attribution.test.mjs` cobre publicação centralizada, processo 23349, correspondência contextual, NE completa e abreviada, contratos vinculados a outra contratação, normalização de escopo PNCP/Compras e leitura do campo oficial de contratação.

## Limites e próximos passos

1. Auditar amostras reais de PNCP, Compras.gov e CGU, inclusive contratos da Reitoria que beneficiam outros campi.
2. Quantificar registros em cada nível de evidência e expor cobertura por fonte/período.
3. Inspecionar a cardinalidade: contratação → múltiplos instrumentos; contrato → múltiplas NEs; NE → liquidações e pagamentos.
4. Não somar valores PNCP e CGU para produzir despesa executada. Valores estimados/homologados e valores registrados em ata não são empenhos nem pagamentos.
5. Homologar casos ambíguos com Contratos/CEOF antes de considerar AUD-05 encerrada.

## Diagnóstico quantitativo automatizado

Executar `npm run audit:attribution` na raiz do repositório para obter JSON agregado de classificação de instrumentos, níveis de evidência de contratos e licitações, quantidade de vínculos oficiais, consultas PNCP concluídas e NEs documentadas na CGU. O relatório inclui as competências examinadas e o SHA quando `GITHUB_SHA` estiver disponível. Não grava dados nem expõe IDs individuais. **As contagens dependem exclusivamente dos arquivos presentes no checkout e não demonstram completude histórica.**

## Execução operacional automatizada

O workflow `.github/workflows/auditar-atribuicao.yml` executa a auditoria sobre os **arquivos reais da revisão** em eventos de alteração de dados na `main` e sob acionamento manual (`workflow_dispatch`). Publica os agregados no **resumo da execução do GitHub Actions**, com SHA e competências, sem versionar um novo JSON de resultados. Antes de emitir contagens, executa `npm run check:data`.

O relatório é uma fotografia do acervo versionado e não atesta completude histórica, atualização das APIs, saldo de contrato ou execução financeira. A análise de lacunas deve priorizar: (1) contratos sem consulta de NE concluída, como **lacuna de observabilidade**, não presunção de infração; (2) contratos sem ID de contratação; (3) NEs integrais referenciadas sem documento CGU; (4) **identificação e consulta das ARPs** para licitações SRP, sem exigir que produzam contratos ou empenhos; (5) contratos atribuídos apenas por processo/fornecedor. Licitações sem contrato relacionado não são automaticamente pendências. É necessário conferir amostras reais antes de alterar critérios de classificação.

## Política incremental de consulta PNCP — NEs

Uma resposta PNCP paginada integralmente, mas sem referência explícita à UG 158459, permanece registrada como consulta completa com lista vazia. Isso **não demonstra ausência definitiva de empenho**: a fonte pode publicar vínculos posteriormente ou não oferecer essa relação. O coletor volta a consultar registros vazios após **30 dias**, priorizando consultas nunca realizadas; erros continuam elegíveis a nova tentativa após **7 dias**. Referências explícitas existentes são preservadas e não reconsultadas automaticamente, salvo execução manual com `PNCP_COMMITMENT_RECHECK=true`. A política limita chamadas repetidas e não inventa NEs.

## Correção conceitual: SRP, ata e empenho

Nos arts. 82–86 da Lei 14.133/2021, o Sistema de Registro de Preços é procedimento auxiliar que permite registrar condições para contratações futuras. O art. 83 afirma que a existência de preços registrados implica compromisso de fornecimento nas condições estabelecidas, **mas não obriga a Administração a contratar**. O art. 84 estabelece vigência da ata de um ano, prorrogável por igual período desde que comprovada a vantajosidade do preço. A ata não é nota de empenho, contrato formal ou despesa executada. O Decreto 11.462/2023 disciplina o SRP na esfera federal.

**Exemplo:** um pregão SRP realizado pelo IFC pode gerar ata válida por um ano e não gerar nenhum empenho se não houver demanda, disponibilidade orçamentária ou conveniência de aquisição. Em contrapartida, uma mesma ata pode subsidiar várias contratações e empenhos em momentos e exercícios distintos, inclusive de unidades participantes, observadas as regras aplicáveis. Não deduzir quantitativos efetivamente adquiridos de quantidades registradas.

O modelo correto distingue: (a) **planejamento e origem administrativa** da demanda; (b) **procedimento licitatório/contratação direta** e resultado; (c) **ata de registro de preços** e sua vigência; (d) **contratação efetiva**, por termo formal ou instrumento legalmente substitutivo; (e) **execução orçamentária e financeira** (NE, liquidação, pagamento). Relações são 0:N ou N:M conforme fonte; não é uma cadeia obrigatória de um para um.

A auditoria agora informa separadamente quantas publicações estão marcadas `srp=true` e quantas **não têm instrumento decorrente identificado no catálogo atual**. Isso **não** é indicador de empenhos faltantes, irregularidades, compras não realizadas ou ausência de ata. O catálogo de ARPs ainda não foi implementado; a ausência de registro de ata nesta base não significa que a ata não exista no PNCP.

Fontes: [Lei 14.133/2021, arts. 82–86](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm); [Decreto 11.462/2023](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/decreto/d11462.htm).

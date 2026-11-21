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

A categoria `confirmed` comprova **atribuição documental à UG**, não o valor efetivamente executado, a vigência ou a existência de saldo contratual. Uma licitação centralizada só herda atribuição confirmada quando existe vínculo oficial ao contrato que, por sua vez, tem NE confirmada.

## Testes adicionados

`test/audit-attribution.test.mjs` cobre publicação centralizada, processo 23349, correspondência contextual, NE completa e abreviada, contratos vinculados a outra contratação, normalização de escopo PNCP/Compras e leitura do campo oficial de contratação.

## Limites e próximos passos

1. Auditar amostras reais de PNCP, Compras.gov e CGU, inclusive contratos da Reitoria que beneficiam outros campi.
2. Quantificar registros em cada nível de evidência e expor cobertura por fonte/período.
3. Inspecionar a cardinalidade: contratação → múltiplos instrumentos; contrato → múltiplas NEs; NE → liquidações e pagamentos.
4. Não somar valores PNCP e CGU para produzir despesa executada.
5. Homologar casos ambíguos com Contratos/CEOF antes de considerar AUD-05 encerrada.

## Diagnóstico quantitativo automatizado

Executar `npm run audit:attribution` na raiz do repositório para obter JSON agregado de classificação de instrumentos, níveis de evidência de contratos e licitações, quantidade de vínculos oficiais, consultas PNCP concluídas e NEs documentadas na CGU. O relatório inclui as competências examinadas e o SHA quando `GITHUB_SHA` estiver disponível. Não grava dados nem expõe IDs individuais. **As contagens dependem exclusivamente dos arquivos presentes no checkout e não demonstram completude histórica.**

## Execução operacional automatizada

O workflow `.github/workflows/auditar-atribuicao.yml` executa a auditoria sobre os **arquivos reais da revisão** em eventos de alteração de dados na `main` e sob acionamento manual (`workflow_dispatch`). Publica os agregados no **resumo da execução do GitHub Actions**, com SHA e competências, sem versionar um novo JSON de resultados. Antes de emitir contagens, executa `npm run check:data`.

O relatório é uma fotografia do acervo versionado e não atesta completude histórica, atualização das APIs, saldo de contrato ou execução financeira. A análise de lacunas deve priorizar: (1) contratos sem consulta de NE concluída; (2) contratos sem ID de contratação; (3) NEs integrais referenciadas sem documento CGU; (4) licitações sem contrato relacionado; (5) contratos atribuídos apenas por processo/fornecedor. É necessário conferir amostras reais antes de alterar critérios de classificação.

## Política incremental de consulta PNCP — NEs

Uma resposta PNCP paginada integralmente, mas sem referência explícita à UG 158459, permanece registrada como consulta completa com lista vazia. Isso **não demonstra ausência definitiva de empenho**: a fonte pode publicar vínculos posteriormente ou não oferecer essa relação. O coletor volta a consultar registros vazios após **30 dias**, priorizando consultas nunca realizadas; erros continuam elegíveis a nova tentativa após **7 dias**. Referências explícitas existentes são preservadas e não reconsultadas automaticamente, salvo execução manual com `PNCP_COMMITMENT_RECHECK=true`. A política limita chamadas repetidas e não inventa NEs.

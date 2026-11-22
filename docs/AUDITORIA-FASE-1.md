# Auditoria inicial — fase 1

Status: **iniciada**, inventário estático do repositório; não é homologação contábil nem auditoria completa dos dados. Revisar e atualizar com evidências de execução.

## Inventário constatado
- Coleta de documentos CGU: `src/collect-cgu.mjs`, `src/cgu.mjs`, `src/store.mjs`.
- Recuperação histórica: `src/backfill.mjs`, `src/backfill-cgu.mjs`.
- Vínculos e itens: `src/enrich-cgu.mjs`, `src/enrich-month.mjs`.
- Qualidade: `src/validate-data.mjs`, `src/diagnose-coverage.mjs`, testes em `test/`.
- Contratos: `src/procurement.mjs`, `src/procurement-store.mjs`, `src/collect-procurement.mjs`.
- Compras/PNCP: `src/pncp-notices.mjs`, `src/pncp-commitments.mjs`, `src/pncp-contract-link.mjs` e coletores correlatos.
- Interface: `index.html`, `assets/`, publicação via `.github/workflows/publicar-pages.yml`.
- Agendamentos: workflows de CGU, recuperação, enriquecimento, PNCP e contratos.
- Documentação preexistente: `docs/ARQUITETURA.md`, `docs/MODELO-CONCEITUAL-DESPESAS.md`, `docs/HOMOLOGACAO-TRAJETORIAS.md`.

Este inventário prova presença de componentes no código, **não** sua cobertura, precisão ou funcionamento em produção.

## Matriz inicial de fontes
| Fonte | Uso atual ou planejado | Verificação pendente |
| --- | --- | --- |
| CGU/Portal da Transparência | Documentos de despesa e vínculos | Completude por fase/data, paginação, divergências, NE histórica |
| PNCP | Compras, instrumentos, licitações e vínculos | Duplicidade, tipo de instrumento, UG beneficiária, atualização |
| Compras.gov/Contratos.gov | Catálogo e contratos | Chaves oficiais, vigência, aditivos e cobertura |
| SIAFI/Tesouro Gerencial | Créditos, saldos, RAP e conciliação | Acesso autorizado, relatórios, layout, periodicidade |
| SIOP | Orçamento federal | Granularidade da UG, conceitos e API |
| SIPAC/controles internos | Demandas, processos e execução operacional | Permissões, exportações, privacidade e responsabilidade |

## Riscos prioritários
1. **Crítico:** confundir UO 26422 e UG 158459 ou tratar publicações institucionais como despesas do Campus.
2. **Crítico:** deduzir saldo orçamentário, financeiro ou RAP de documentos CGU sem conciliação SIAFI.
3. **Alto:** contar empenho substitutivo na tabela de contratos formais ou somar PNCP e CGU.
4. **Alto:** cobertura histórica parcial e vínculos não encontrados produzirem totais aparentes.
5. **Alto:** divergência entre classificação de vínculo confirmado e indício contextual.
6. **Alto:** publicação indevida de dados internos ou identificadores pessoais.
7. **Médio:** custo e crescimento do histórico Git por atualizações frequentes.
8. **Médio:** falhas silenciosas de coleta, enriquecimento e publicação.

## Linha de base a registrar (não presumir)
- SHA da main, horário de referência e versões de esquema.
- Quantidade de competências, documentos, relações e pendências por fase.
- Cobertura completa por data/fase e último sucesso de cada workflow.
- Contratos formais, instrumentos substitutivos e publicações não classificadas.
- Testes de sintaxe, dados, privacidade, conciliação e build.
- Tamanho dos dados públicos, duração de coleta e deploy.

## Backlog de auditoria com aceite
| ID | Prioridade | Tarefa | Critério de aceite |
| --- | --- | --- | --- |
| AUD-01 | P0 | Registrar baseline reproduzível com SHA e data | Relatório gerado por script, sem dados sensíveis |
| AUD-02 | P0 | Auditar classificação formal x instrumento substitutivo | Amostras e testes impedem duplicidade |
| AUD-03 | P0 | Auditar métricas NE/NS/pagamento e RAP | Dicionário e exemplos conciliados com SIAFI |
| AUD-04 | P0 | Verificar cobertura histórica CGU por exercício | Datas/fases incompletas expostas sem totais definitivos |
| AUD-05 | P1 | Validar chaves PNCP/Compras e UG beneficiária | Vínculos oficiais separados dos contextuais |
| AUD-06 | P1 | Inventariar relatórios internos autorizados | Campos, frequência, responsável e permissões |
| AUD-07 | P1 | Medir desempenho, retenção e tamanho de artefatos | Indicadores de tempo/volume e limites definidos |
| AUD-08 | P1 | Revisar segurança da publicação e secrets | Checklist de privacidade e allowlist de Pages |
| AUD-09 | P1 | Homologar indicadores com DAP, CEOF, Contratos e Compras | Registro de aceite ou ressalvas por indicador |

## Ordem imediata
1. Executar AUD-01 e AUD-04 com base nos JSONs existentes.
2. Validar AUD-02 e AUD-03 com exemplos reais antes de criar novos cards.
3. Definir matriz de fonte por métrica e limites de integração SIAFI.
4. Só então avançar para novos painéis orçamentários.

## Não conclusões
Este documento não afirma que dados históricos estão completos, que RAP já é calculável, que contratos estão conciliados ou que as integrações internas possuem acesso autorizado.

## AUD-01 — Comando implementado

Executar `npm run audit:baseline` no checkout da revisão que se deseja auditar. Para identificar o commit no relatório, usar `GITHUB_SHA=$(git rev-parse HEAD) npm run audit:baseline` em ambiente local com Git, ou o `GITHUB_SHA` do GitHub Actions. A saída é JSON de agregados, por competência, sem IDs individuais de NE ou dados pessoais. **Nenhum arquivo de histórico é gerado automaticamente**.

O relatório permite comparar documentos, vínculos, enriquecimentos pendentes, NEs referenciadas mas ainda não recuperadas e dias com três fases completas. O número de dias consultados não representa necessariamente todos os dias do calendário; a cobertura precisa ser interpretada por fase e competência. AUD-01 está implementada no código, mas o registro e a revisão de uma linha de base operacional continuam necessários.

## AUD-02 e AUD-03 — Implementação inicial

AUD-02: adicionados testes de regressão da classificação de contratos formais, notas de empenho substitutivas e outros instrumentos, sem inferência pelo número ou processo. AUD-03: criado [dicionário preliminar de indicadores](DICIONARIO-INDICADORES.md), com fontes, limitações e exemplos de dupla contagem. **A conciliação contábil real com SIAFI/Tesouro permanece pendente de dados e homologação.**

## AUD-05 — Auditoria inicial de chaves e escopo

Documentadas as [regras de atribuição](AUDITORIA-ATRIBUICAO.md) e adicionados testes de regressão para vínculos oficiais versus indícios contextuais. **AUD-05 permanece parcialmente concluída**: faltam amostragem dos registros reais, métricas de cobertura e homologação de casos ambíguos.

## Atualização do replanejamento v0.2 — 22/11/2026

A linha de base pública passa a incluir o intervalo inteiro de dias encerrados desde `2025-01`: um mês não coletado é contado como competência ausente, não como zero, e dias parcialmente coletados não são considerados completos. O comando `node src/diagnose-coverage.mjs --audit-md` gera o resumo agregado na CI e nos lotes históricos; não cria novo JSON de histórico nem expõe IDs de documentos.

**Fotografia anterior ao replanejamento:** 980 documentos, 493 vínculos, três competências com arquivos parciais, 52 NEs originais, 47 NEs referenciadas sem documento e 679 enriquecimentos pendentes. As quantidades mudam conforme a coleta.

**AUD-01:** implementação da linha de base automatizada e seu resumo; acompanhamento humano do resultado ainda pendente. **AUD-04:** implementação da contagem de lacunas por calendário; a cobertura histórica real segue incompleta. **AUD-02:** regressão de instrumentos formais/substitutivos disponível, mas amostras jurídicas adicionais necessárias. **AUD-03 e AUD-09:** dicionário de indicadores existe, sem homologação ou conciliação contábil. **AUD-05:** evidências e classificações automatizadas, ainda com ambiguidade em publicações centralizadas. **AUD-06 a AUD-08:** controles e avaliações adicionais permanecem pendentes.

**Bloqueio operacional identificado:** o lote histórico executado em 22/11/2026 falhou em todos os três dias tentados (14 a 16/10), sem detalhes de causa nos logs antigos. A frequência permanece em **um lote diário de três dias** até esclarecer essas falhas. O coletor passa a registrar categorias seguras de erros (HTTP, rede, timeout, JSON ou validação), sem payloads nem identificadores. Investigar, estabilizar e só então avaliar duplicar a frequência.

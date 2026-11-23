# Sondagem de cancelamentos e estornos nos itens de NEs antigas

## Contexto

A auditoria CGU de RP [run #45096662414](https://github.com/guimig/observatorio-despesas/actions/runs/45096662414) consultou 18 documentos, com 24 linhas completas de impactos; 16 linhas eram de NEs de anos anteriores, das quais 10 tinham `valorRestoPago` positivo. Não foram encontrados `valorRestoCancelado` ou `valorRestoInscrito` positivos na amostra limitada. Esses resultados não são saldos nem representam o universo das NEs.

## Etapa seguinte

A sondagem independente `src/inspect-cgu-ne-history.mjs`, disparada manualmente ou uma vez por alteração do próprio workflow/código na `main`, seleciona até 14 NEs da UG 158459, priorizando NEs de exercícios anteriores vinculadas a liquidações e pagamentos posteriores e preservando controles do exercício corrente. Seleciona até três itens por NE (priorizando itens de valor atual zero, primeiro e último sequencial), consulta até quatro páginas de histórico por item e respeita intervalo entre NEs.

Saída: somente contagem de NEs e itens examinados, históricos completos/incompletos, categorias de movimentos (original, reforço, anulação, cancelamento, estorno e ambíguo) e ano relativo de eventual cancelamento. Nunca registra valores, número de empenho, sequencial, descrições, CPF, token ou resposta de API. Não altera dados mensais, não adiciona base persistente e não altera rotinas regulares de enriquecimento.

**Limites:** amostragem por itens não confirma a ausência de cancelamentos nos itens não selecionados; histórico vazio não significa ausência de movimentação contábil em outras fontes. O campo `valorRestoCancelado` nos impactos não equivale diretamente à operação `CANCELAMENTO` do item. A data de emissão formal, a situação de RP processado/não processado e qualquer saldo necessitam de fonte contábil homologada e validação da CEOF. Resultados dos ensaios devem ser interpretados apenas como evidências de ocorrência da operação.

## Homologação

Validar `npm run check:syntax`, `npm test`, `npm run check:data`, build Pages e planejamento histórico em CI. Após merge, verificar o workflow autenticado e registrar somente conclusões agregadas, inclusive se houver falhas de API ou ausência de históricos completos. Não encerrar a issue #29 ou publicar indicadores de saldo. Rollback por revert da PR, sem migração.

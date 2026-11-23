# Sondagem de cancelamentos e estornos nos itens de NEs antigas

## Contexto

A auditoria CGU de RP [run #45096662414](https://github.com/guimig/observatorio-despesas/actions/runs/45096662414) consultou 18 documentos, com 24 linhas completas de impactos; 16 linhas eram de NEs de anos anteriores, das quais 10 tinham `valorRestoPago` positivo. Não foram encontrados `valorRestoCancelado` ou `valorRestoInscrito` positivos na amostra limitada. Esses resultados não são saldos nem representam o universo das NEs.

## Etapa seguinte

A sondagem independente `src/inspect-cgu-ne-history.mjs`, disparada manualmente ou uma vez por alteração do próprio workflow/código na `main`, seleciona até 14 NEs da UG 158459, priorizando NEs de exercícios anteriores vinculadas a liquidações e pagamentos posteriores e preservando controles do exercício corrente. Seleciona até três itens por NE (priorizando itens de valor atual zero, primeiro e último sequencial), consulta até quatro páginas de histórico por item e respeita intervalo entre NEs.

Saída: somente contagem de NEs e itens examinados, históricos completos/incompletos, categorias de movimentos (original, reforço, anulação, cancelamento, estorno e ambíguo) e ano relativo de eventual cancelamento. Nunca registra valores, número de empenho, sequencial, descrições, CPF, token ou resposta de API. Não altera dados mensais, não adiciona base persistente e não altera rotinas regulares de enriquecimento.

**Limites:** amostragem por itens não confirma a ausência de cancelamentos nos itens não selecionados; histórico vazio não significa ausência de movimentação contábil em outras fontes. O campo `valorRestoCancelado` nos impactos não equivale diretamente à operação `CANCELAMENTO` do item. A data de emissão formal, a situação de RP processado/não processado e qualquer saldo necessitam de fonte contábil homologada e validação da CEOF. Resultados dos ensaios devem ser interpretados apenas como evidências de ocorrência da operação.

## Homologação

Validar `npm run check:syntax`, `npm test`, `npm run check:data`, build Pages e planejamento histórico em CI. Após merge, verificar o workflow autenticado e registrar somente conclusões agregadas, inclusive se houver falhas de API ou ausência de históricos completos. Não encerrar a issue #29 ou publicar indicadores de saldo. Rollback por revert da PR, sem migração.

## Resultado real da primeira sondagem — 23/11/2026

O workflow [#45097137828](https://github.com/guimig/observatorio-despesas/actions/runs/45097137828) concluiu autenticado: 14 NEs amostradas, 19 historicos de itens consultados sem falhas, 21 movimentos originais, 39 reforcos, 25 anulacoes e **5 movimentos de categoria `other`** (90 movimentos classificados). Nenhuma operacao `cancellation` ou `reversal` foi classificada nessa amostra. Isso nao permite inferir inexistencia dessas operacoes. A categoria `other` nao equivale a estorno; exige verificacao semantica na fonte SIAFI/CGU antes de alterar o classificador.

## Evolucao da sondagem

- O conjunto de meses vem de todo o manifesto canonico; o ano de controle e o mais recente presente no conjunto, sem fixar 2026.
- A selecao varia deterministicamente pelo numero da execucao do GitHub Actions (em novas execucoes, nao em reruns do mesmo workflow). O limite permanece em **14 NEs, 3 itens por NE e 4 paginas por historico**. Nao e um censo e pode haver repeticao de notas entre janelas, especialmente entre coortes.
- Os resumos discriminam itens disponiveis, itens efetivamente amostrados e itens nao amostrados. `sampled_only` significa historicos selecionados completos, **mas nao a NE integralmente conferida**. `partial` continua reservado a falha de consulta do historico amostrado.
- Alem dos cancelamentos, as operacoes `other` ganham somente agrupamento temporal em exercicio anterior/mesmo/posterior ou data invalida, sem imprimir operacao bruta, valor ou identificador. A categoria `other` nao deve ser reclassificada por suposicao.
- O plano e os resumos seguem efemeros, sem novos JSONs publicos, novos Secrets ou saldo de RAP presumido.

**Aceite tecnico:** testes de rotacao, ausencia de duplicacao na janela, atualizacao do ano de referencia, status de amostragem incompleta, categorizacao temporal e privacidade; CI e sondagem autenticada apos merge. **Aceite contabil:** pendente de evidencia oficial do significado das operacoes desconhecidas e dos eventos de RP; a issue #29 permanece aberta.

## Cruzamento documental efemero da janela rotativa — 23/11/2026

A [execucao autenticada #45161073355](https://github.com/guimig/observatorio-despesas/actions/runs/45161073355) concluiu com sucesso: **14 NEs examinadas**, com 4 movimentos `other`, todos posteriores ao exercicio da NE. Dois empenhos tinham itens nao amostrados; por isso historicos dos itens selecionados completos nao equivalem a conferencia do empenho inteiro. Nenhuma operacao `cancellation` ou `reversal` foi identificada nessa janela.

A nova etapa busca **pistas**, sem mudar a classificacao oficial: o texto `operacao` das movimentacoes `other` e confrontado somente em memoria com um vocabulário fechado (inscricao, reinscricao, restos a pagar, baixa, liquidacao, pagamento, transferencia, exclusao, retificacao, ajuste ou sem pista). Sao impressas apenas **contagens por classe**, nunca a frase original ou IDs de NE. Pista lexical nao confirma evento contábil, semantica nem sinal.

Para NEs com `other` em exercicio posterior, o diagnostico cruza as **relacoes explicitas ja armazenadas** com documentos NS/OB/DF posteriores, em no maximo quatro NEs e oito documentos, ate dois documentos de fases diferentes por NE (priorizando fase 3 e depois fase 2). Documentos N:M podem atender varias NEs, sem duplicar a consulta; nenhuma aresta NS→OB e fabricada. Os endpoints CGU `/despesas/empenhos-impactados` sao consultados de modo autenticado, com quatro paginas por documento e identificacao de NE SIAFI **integral** na propria linha retornada. O cruzamento exige que a NE integral tambem esteja no conjunto de vinculos explicitos da consulta.

Somente apos pagina terminal vazia e esquema valido, os campos `valorRestoInscrito`, `valorRestoCancelado`, `valorRestoPago`, `valorPago` e `valorLiquidado` sao resumidos por presenca, sinal e especie documental. IDs, valores, descricoes, CPF e respostas brutas nao saem do runner. Se houver falta de paginacao, timeout ou resposta invalida, os campos parciais sao descartados e o status permanece `partial` ou `unavailable`. `empty` e `no_match` nao significam RP inexistente.

**Aceite tecnico:** teste de operacao lexical, N:M, chave NE integral, fases, paginas, respostas vazias, 429/erro e sigilo; CI, Pages e auditoria autenticada na main. **Aceite contabil:** nao realizado. Uma linha com `valorRestoPago` positivo e evidencia de campo documental da CGU, nao prova saldo contábil, situacao processado/nao processado nem inscricao. Nao somar linhas, documentos ou instrumentos PNCP; nao habilitar cards monetarios. Conciliação oficial e conferencia CEOF seguem pendentes.

## Auditoria de rótulos textuais de inscrição — 23/11/2026

A etapa seguinte registra exclusivamente categorias do campo `operacao` das movimentações já classificadas como `other`, sem reclassificar o evento contábil: rótulo `INSCRICAO` exato, forma qualificada (`INSCRICAO DE/EM RESTOS A PAGAR`, `INSCRICAO DE/EM RP`), menção textual não padronizada, outro rótulo e informação ausente. A rotina agrega, por coorte, a posição temporal do evento em relação ao exercício da NE (anterior, mesmo ano, seguinte, posterior ao seguinte ou inválida) e somente o sinal do valor documental informado pela CGU (positivo, zero, negativo ou indisponível).

**Esses resultados não são inscrições contábeis confirmadas.** O critério literal não verifica conta, saldo, evento SIAFI, modalidade RPP/RPNP, baixa ou conciliação. Datas inválidas ou valores não inteiros permanecem indisponíveis, nunca são convertidos em zero. O resumo não inclui texto livre, valores, identificadores nem documentos individuais.

A futura homologação fica condicionada ao [protocolo de conciliação SIAFI/Tesouro Gerencial](PROTOCOLO-CONCILIACAO-RAP.md). Permanecem inalterados o armazenamento público, o dashboard, os limites de 14 NEs/3 itens/4 páginas, a frequência dos workflows e o esquema publicado. Rollback por revert da PR, sem alteração de dados.

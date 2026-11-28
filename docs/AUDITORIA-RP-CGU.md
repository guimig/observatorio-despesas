# Auditoria de evidencias documentais de restos a pagar na CGU

## Resultado autenticado inicial — 22/11/2026 (run 45096228750)

A primeira auditoria da PR #108 foi concluida com sucesso, em quatro documentos UG 158459:

| Perfil de documento | Vinculo a NE anterior | Evidencia no endpoint impactados |
| --- | --- | --- |
| NS / fase 2 | Sim | Todos os cinco campos consultados com valor zero na linha |
| DF / fase 3 | Sim | `valorRestoPago` positivo; demais campos zero |
| NS / fase 2 | Nao (mesmo exercicio) | `valorLiquidado` positivo; demais zero |
| DF / fase 3 | Nao (mesmo exercicio) | `valorPago` positivo; demais zero |

**Interpretacao:** ha evidencia real de que o recurso distingue um pagamento
atribuido ao campo de RP pago de um pagamento do exercicio. Isso nao prova,
isoladamente, inscricao individual ou pagamento integral da NE, nem
homologa RP processado/nao processado. A amostra nao encontrou campo
`valorRestoCancelado` positivo, mas quatro documentos nao bastam
para afirmar ausencia de cancelamentos.

## Proxima etapa — amostragem estratificada e comparacao por exercicio

A consulta permanece **somente leitura** no runner GitHub Actions, usando
`CGU_API_KEY` no ambiente e sem gerar bases, snapshots ou arquivos novos de
dados. O novo limite e **ate 18 documentos** por execucao, **ate quatro paginas
por documento**, com intervalo de 650 ms entre documentos, alem dos retries
ja previstos no adaptador CGU. A agenda continua apenas manual e por push
dos arquivos tecnicos da auditoria; nao ha novo cron.

A escolha e estratificada em NS, OB e DF, priorizando documentos com
relacao publica a NE de exercicio anterior e mantendo controles com NE do
mesmo exercicio. Um ID de documento so entra uma vez no lote.
O vinculo do acervo serve apenas para selecionar a amostra.

Cada linha da resposta de `/despesas/empenhos-impactados` e classificada
segundo o **ano inscrito no codigo SIAFI completo do empenho retornado**:
`prior`, `same`, `future` ou `unknown`. Identificador abreviado,
de outra UG ou ausente permanece `unknown` e nao e atribuido por inferencia.
O ano compara documento amostrado e empenho explicitamente associado na
mesma linha; nao se confunde com ano da consulta ou competencia do JSON.

Para cada perfil sao registradas somente contagens dos campos
`valorLiquidado`, `valorPago`, `valorRestoInscrito`,
`valorRestoCancelado` e `valorRestoPago` em categorias
`missing`, `invalid`, `negative`, `zero`, `positive`.
As categorias sao sinais de valores brutos **da fonte**, nao classificacao
contabil; nenhum montante ou identificador e impresso ou gravado.

Uma pagina terminal vazia conclui a **paginacao daquele documento**,
nao todo o historico da NE. Resposta vazia no inicio e distinta de campo
financeiro zero. Falha, limite de paginacao, duplicidade e formato inesperado
produzem estado indisponivel ou parcial, sem atestar inexistencia de despesa.

## Dependencias e limites para indicadores

- Verificar a semantica dos cinco campos, sinais, estornos e granularidade em
  amostras oficiais SIAFI/Tesouro Gerencial, especialmente RP processado e nao
  processado e cancelamentos efetivos.
- Procurar amostra **real** de cancelamento/estorno de item de NE no historico
  CGU; isto e diferente de `valorRestoCancelado` nos documentos impactados.
- Confirmar inscricao, pagamento e saldo atual por fonte contabil apropriada,
  com competencia, demonstrativo, ano de inscricao e validacao da CEOF.
- Nao somar campos de diferentes linhas/documentos para inferir saldos;
  nao inferir NS paga por DF/OB; nao incluir cards financeiros ate conciliacao.
- A issue #29 permanece aberta. Reverter a PR remove apenas diagnostico,
  workflow e testes, sem apagar historico nem alterar JSONs canonicos.

## Controle de execucao

Verificar em CI: sintaxe, testes unitarios, esquema/privacidade e Pages.
Apos merge conferir o run autenticado e registrar se houve valores positivos
de `valorRestoInscrito` ou `valorRestoCancelado` **por tipo de documento e
coorte**, sempre sem divulgar montantes individuais. O resultado e exploratorio:
aumentar o numero de amostras nao transforma a evidencia em reconciliacao.


## 27/11/2026 — Evidência de inscrição e componentes de impacto

No JSON de 2024-12, a análise encontrou 42 ocorrências do rótulo oficial
`INSCRICAO EM RP` em 35 itens de 34 NEs de 2024, todas com data documental
2025-01-11. Sete itens apresentam duas linhas indistinguíveis de inscrição
e também inclusões originais repetidas. A data da fonte não comprova o
exercício contábil de inscrição; não somar essas ocorrências, nem eliminar
linhas canônicas sem identidade oficial. O classificador derivado reconhece
o rótulo qualificado, preservando `type:other` dos JSONs históricos e o
bloqueio de reconstruções aritméticas ambíguas.

O enriquecimento de liquidações/pagamentos passa a preservar os cinco
campos de impacto em `relations[].impactComponents` por par documento/NE:
`liquidatedCents`, `paidCents`, `rpInscribedCents`, `rpCancelledCents`,
`rpPaidCents`, mais contagens `rowCount` e `repeatedRows`. Somente após
paginação completa; campo omitido/inválido/overflow ou linhas
indistinguíveis tornam o componente indisponível (null), nunca zero.
Mantém `cents` e todos os indicadores legados intactos; as novas evidências
não autorizam calcular saldo, inscrição contábil ou modalidade RPP/RPNP.
A telemetria agrega somente contagens, inclusive duplicidades.
Uma vaga da revisão documental existente por fase/competência prioriza
vínculos interanuais sem componentes completos, respeitando cooldown,
rodízio, cotas e agenda atuais. Não altera dados manualmente, não adiciona
fonte, base, credencial ou rotina de publicação. O código de coleta de
valor documental original continua legado; a fila de enriquecimento
recupera os componentes progressivamente. Saldos seguem indisponíveis.

Validação: testes de componentes, campos ausentes, zero explícito, sinais,
páginas incompletas, duplicidade e compatibilidade mensal. Homologação
contábil e confronto com arquivos oficiais continuam pendentes. Rollback:
reverter o PR após remover apenas o campo opcional impactComponents dos
JSONs que tiverem sido enriquecidos (preservando cents e relações).


## Sondagem dirigida de duplicidades e componentes — 27/11/2026

A investigação da issue #29 passa a reconsultar diretamente os itens com
rótulo de inscrição já identificado, dando prioridade às duplicidades
conhecidas (até 10 itens, com pelo menos um controle se disponível).
Somente NEs desde 2024, de proprietário único e sequenciais inequívocos.
A mesma rodada seleciona até seis documentos NS/OB/DF com relações
interanuais explícitas, priorizando os associados às inscrições repetidas,
depois às demais inscrições, com alternância entre fases.

A rotina compara multiconjuntos de movimentos armazenados e respostas
novas normalizadas, distinguindo repetição idêntica no conteúdo bruto,
diferença entre linhas normalizadas iguais e presença de campos adicionais
de identidade. Os campos adicionais são pistas, não chaves homologadas.
Somente paginação terminal completa permite a análise. Não deduz
duplicidade contábil por igualdade de valores, nem apaga registros.
Nos impactos compara pares conhecidos, valor legado, cobertura dos
cinco campos, sinais e possíveis linhas repetidas, separados por fase.
Consultas vazias, falhas e pares ausentes não são interpretados como saldo
zero. Logs e sumários contêm exclusivamente contagens agregadas.

Workflow sem cron, disparo manual ou alteração do código de diagnóstico
integrada à main. Usa grupo de concorrência da coleta CGU, sem gravar
JSON, com teto de 48 requisições inclusive tentativas, 4 minutos, intervalo
mínimo de 1,5 segundo e quatro páginas por consulta. Não amplia cotas das
coletas regulares. A simulação `node src/audit-rap-targeted.mjs --dry-run`
não consulta API. Testes reproduzem repetição literal, linhas com identidade
adicional, alterações de multiplicidade, página repetida e campos ausentes.
Confronto com arquivos oficiais e validação contábil continuam pendentes.
Rollback por revert, sem migração ou alteração de dados.

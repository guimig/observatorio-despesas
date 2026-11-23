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

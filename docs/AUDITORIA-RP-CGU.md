# Auditoria de evidencias de restos a pagar na CGU (etapa experimental)

Esta auditoria e **somente leitura**, executada em GitHub Actions com CGU_API_KEY, sem
nova base, sem alterar arquivos de dados ou expor identificadores e valores em logs.

O algoritmo seleciona ate quatro documentos NS/OB/DF da UG 158459 que tenham
relacao CGU com NEs de exercicios anteriores e, como controle, documentos com
NEs do proprio exercicio. Esta relacao e **criterio de amostragem**, jamais
prova de inscricao em restos a pagar, nem distingue RP processados de nao processados.

Para cada documento, o endpoint oficial \`/despesas/empenhos-impactados\` e
consultado com a fase 2/3 e ate quatro paginas. Apenas contagens de campos
presentes/ausentes, invalidos, positivos, zero e negativos sao registradas
para \`valorLiquidado\`, \`valorPago\`, \`valorRestoInscrito\`,
\`valorRestoCancelado\` e \`valorRestoPago\`. O termino por pagina vazia
indica conclusao *da amostra paginada*, nao cobertura completa da NE. Falha
HTTP, repeticao, limite e formato inesperado nao sao interpretados como zero.
Resposta sem linhas indica apenas vazio do endpoint consultado.

**Proibido inferir:** inscricao, cancelamento ou pagamento de RP; saldos,
RP processado/nao processado, quitação, NS especifica paga por OB, ou
acumulacao historica. Os campos sao sondados, mas sua semantica e
granularidade ainda precisam de homologacao em demonstrativo SIAFI/Tesouro
Gerencial e com a CEOF antes de qualquer indicador financeiro publico.

## Execucao e aceite

- PR: CI Node e validacao de dados obrigatorios.
- Apos integracao: verificar o run \`Auditar evidencias documentais de RP na CGU\`,
  registrar resultados agregados de cobertura, classes e eventuais HTTP.
- Identificar fonte oficial de inscricao e saldos por NE e amostras reais
  de cancelamento/estorno; conciliar RP processados e nao processados.
- Sem homologacao, manter a issue #29 aberta e nao publicar cards financeiros.
- Rollback: revert da PR. Nao ha migracao ou dado a excluir.

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


## Recuperação priorizada e rodízio — 27/11/2026

O diagnóstico pós-merge da PR #198 (run 46094349948) encontrou 54 NEs
de 2024, 55 itens com 72 ocorrências de inscrição, 17 repetições em 17
itens e 349 pares documentais interanuais, ainda sem componentes novos.
A primeira sondagem dirigida e a coleta estavam enfileiradas, portanto
não há conclusão sobre a origem da duplicidade.

Reserva global de até 20% (mínimo uma vaga quando a fase possui vagas)
dos lugares não protegidos de liquidação/pagamento, sem aumentar o total.
Preserva prioridades de vínculos relacionados/contratos e alternância com
catálogos e históricos. Prioriza primeira coleta dos componentes, com
reserva de origem 2025 quando houver pelo menos duas vagas; componentes
parciais seguem revisão normal e cooldown. Reconsulta dirigida que omita
ou altere valor de vínculo anterior é isolada para investigação, não
publicada como correção do saldo. Telemetria distingue pares sem campos
de pares parciais por exercício da NE.

A auditoria usa janela determinística por número de execução, mantendo
o limite de dez itens e seis documentos, com até dois itens de NEs de
2025 ainda sem inscrição identificada e preferência por vínculo posterior
explícito. Preserva controle e rodízio das duplicidades. Não há novo cron,
orçamento HTTP, banco ou publicação de saldo. Rollback por revert.


## Resultado autenticado e trajetória documental — 27/11/2026

Run 46094349965: 32/32 HTTP 200; dez históricos completos com o mesmo
multiconjunto armazenado. Sete grupos de inscrições repetidas já eram
literalmente idênticos na resposta bruta da API; não foram encontrados
campos adicionais de identidade distintos. Dois itens de origem 2025
não apresentaram inscrição nesta amostra. Seis documentos financeiros
completos, seis pares anteriores conferidos e valores legados coincidentes.
Três pares de pagamento com valorRestoPago positivo; os seis tiveram
valorRestoInscrito e valorRestoCancelado explicitamente zero. A amostra
não estabelece identidade contábil nem ausência de outras inscrições.
Run 46094097382: 111 consultas concluídas sem falha, 240 HTTP 200;
67 NEs de 2024, 68 itens, 87 ocorrências, 19 repetições; 365 pares
interanuais, dez com os cinco componentes disponíveis. Continuar rodízio.

A trajetória documental derivada em assets/rap-trajectory.js não altera
JSONs nem cria base. Agrupa ocorrências idênticas por NE integral e
sequencial, conserva multiplicidade e valor por ocorrência, sem totalizar.
Bloqueia componentes quando identidade, par, consulta ou aritmética não
sustentam a evidência. Vínculos interanuais são candidatos; evidência
explícita requer rótulo qualificado ou campo RP não zero confirmado.
Não presume exercício de inscrição pela data, modalidade RPP/RPNP,
saldo ou ligação NS-OB. Ausência de campo não é zero. A interface
reutiliza a aba Trajetória, filtro por origem/evidência e ficha da NE
com componentes por documento e cobertura das competências carregadas.
Não cria cron, chamadas autenticadas, importação nem dados paralelos.
Rollback por revert. Confronto com CSV oficial diário permanece pendente;
a fonte é atualizável, não um razão contábil ou sequência imutável.


## Confronto efêmero com arquivos diários oficiais — 27/11/2026

Fonte oficial: https://portaldatransparencia.gov.br/download-de-dados/despesas/
e dicionário https://portaldatransparencia.gov.br/dicionario-de-dados/empenhos .
O Portal identifica ItemEmpenhoHistorico, Liquidacao_EmpenhosImpactados e
Pagamento_EmpenhosImpactados. O dicionário informa que a planilha de
empenho corresponde à última alteração, não a uma sequência imutável de
eventos; ausência em determinada data não demonstra inexistência de RAP.

A rotina `python3 -m src.probe_rap_csv` reutiliza o download limitado
existente (128 MiB comprimido, 512 MiB dos membros selecionados por
arquivo; processamento sequencial temporário, sem extração persistente).
No máximo duas datas por execução: data mais frequente de inscrição
observada no acervo e data mais recente de pagamento de RAP com
componente conhecido; entrada manual opcional para uma única data.
Sem cron ou credencial. Respeita bloqueios HTTP e não cria artefato.

Cabeçalhos candidatos são uma lista fechada a confirmar na fonte real,
não equivalências homologadas: ambiguidade ou falta de campos resulta
em status explícito. Não imprime cabeçalhos desconhecidos. Identidade
integral da UG 158459 desde 2024 ou junção pelo ID interno oficial
inequívoco do mesmo pacote com documento pai. Nunca usa NE abreviada.
Histórico compara multiconjuntos do rótulo qualificado, sequência,
data, quantidade, valor unitário e centavos, sem somar inscrições.
Impactos comparam cada campo disponível por par interanual; linhas
indistinguíveis e campos inválidos bloqueiam agregação, zero explícito
é distinto de ausência. Diferenças são somente pistas de investigação,
não retificação do dado canônico. O resultado não confirma modalidade
RPP/RPNP, cancelamento ou saldo contábil.

Run 46095256027: 74 NEs, 75 itens, 97 ocorrências de inscrição, 22
repetições; 365 pares interanuais, 32 com os cinco componentes e 333
ainda sem componentes. 240 HTTP 200, 108/109 consultas processadas.
Nenhum valor positivo de RP inscrito/cancelado no conjunto de 116
pares com componentes. Não confundir ausência de valores positivos
no acervo enriquecido com ausência de operações na fonte.

Testes sintéticos de equivalência de multiplicidade, junção interna,
ambiguidade, campos ausentes e divergência. Sondagem real e confirmação
do layout CSV ainda pendentes; rollback por revert sem migração.


## Confronto real e nova seleção de arquivos — 27/11/2026

Run 46096315794: ambos ZIPs HTTP 200, inspecionados. Em 11/01/2025,
arquivo de 8.403 bytes, nenhum dos 75 itens-alvo encontrado com inscrição.
Em 16/11/2026, nove pares interanuais conhecidos com campo RAP pago
positivo, dos quais dois com componentes API; seis comparações de
campos (pago, RAP inscrito, RAP pago) coincidentes. Sete pares conhecidos
ainda sem componentes API. Nenhuma linha ambígua nos nove pares.
Campo de cancelamento não reconhecido nos dois CSVs; isto não comprova
zero ou inexistência de cancelamentos. Dicionário oficial de empenho
confirma que o documento permanece na planilha da última alteração.
A modalidade e o saldo contábil permanecem não homologados.

A seleção deixa de insistir na data da operação: usa datas da listagem
e observações da NE como pistas, alternando coorte com inscrição
conhecida e NEs de 2025 ligadas a execução posterior, por número da
execução. Segunda vaga: datas com pares pendentes, privilegiando em
rodízio os que também possuem pagamentos RP conhecidos. Mantém teto
de dois ZIPs, mesma política temporária e nenhum cron adicional.
Contadores novos distinguem presença da NE/item no histórico do
arquivo, inscrição qualificada, e rótulos de cancelamento/estorno
como pistas não classificadas. Contagem de cabeçalhos candidatos a
cancelamento não mapeia campos por aproximação. Sem importação de
valores ou alteração canônica. Testes cobrem rodízio e diferenciação
de presença/inscrição. Reversão por revert.


## Confronto das inscrições e ponte efêmera para a API — 27/11/2026

Run 46096723143: dois ZIPs HTTP 200, 2024-11-28 e 2026-11-16.
Dez de dez itens-alvo da primeira data localizados com inscrições:
13 ocorrências coincidentes em dez multiconjuntos, nenhuma divergência
de conteúdo ou multiplicidade; três ocorrências adicionais em itens
sem histórico canônico comparável. Quatro repetições observadas no CSV.
Não implica deduplicação contábil. A segunda data revalidou os mesmos
nove pagamentos de RP, dois pares com componentes API e seis campos
coincidentes; sete pares aguardando componentes. Não contar a mesma
amostra duas vezes. A consulta de 2025 permanece em rodízio.

O CSV passa a fornecer alvos efêmeros para consulta API imediatamente
na mesma execução, priorizando inscrições de 2025 e lacunas/divergências
em itens e pares conhecidos. Máximo quatro históricos e seis documentos
financeiros (até 16 pares), 48 requisições incluindo tentativas, 4 minutos,
intervalo de 1,5s e quatro páginas por consulta; mesmo grupo de
concorrência das coletas CGU, sem cron adicional. Identidades integrais,
campos estruturados, multiplicidade preservada, snapshots divergentes
não mesclados. Plano em diretório temporário com permissões restritas,
removido no fim, sem artefato e sem logs de identidades ou valores.
A API consulta novamente e compara multiconjuntos de inscrições e
campos de impacto disponíveis; campos faltantes, divergências e
respostas vazias são distintos. Não altera JSON canônico nem valores.
Inclui variante exata "valor de restos a pagar cancelados", expressão
usada na apresentação oficial da CGU; cabeçalho real deve ser confirmado,
ambiguidade continua bloqueando. Não classifica "valor anulado"
genericamente como RAP. Fonte: página de documentos de liquidação
do Portal da Transparência, https://portaldatransparencia.gov.br/despesas/liquidacao/170394000012022NS001928 .
Reversão por revert. Homologação contábil e saldo permanecem pendentes.


## Recuperação aditiva de lacunas confirmadas — 27/11/2026

Run 46097275780: seis NEs-alvo de 2025 localizadas no arquivo
2025-12-18, nenhuma inscrição qualificada observada nessa amostra.
No ZIP 2026-03-12, dez pares interanuais de liquidação, doze linhas,
todos já conhecidos e sem componentes canônicos; quatro campos
reconhecidos, todos explicitamente zero. O campo de cancelamento
foi reconhecido em ambos os CSVs. O lote selecionou seis documentos
e oito pares, todos confirmados na API: 32 comparações de campos
coincidentes (liquidado, RP inscrito, RP cancelado e RP pago).
12 requisições HTTP 200. Ausência de valor positivo de cancelamento
não prova ausência de baixa, e zero de valorLiquidado não comprova
que a NS não tenha finalidade contábil distinta.

A rotina anterior era somente leitura; agora o modo explícito
--apply-confirmed, usado no workflow existente, recupera somente
lacunas aditivas, sem importar valores do CSV. Históricos: igualdade
do multiconjunto qualificado CSV/API, resposta API completa,
proprietário único, catálogo v2 e sequencial já existente ainda
não consultado. Preserva todas as ocorrências normalizadas da API,
inclusive multiplicidade; não altera histórico já consultado.
Impactos: quatro campos pertinentes CSV e cinco campos API
verificáveis, nenhuma repetição ambígua, par canônico sem componentes,
documento único com consulta de vínculos concluída, e conjunto
integral de vínculos API idêntico aos legados em identidade/centavos.
Não retifica componentes, não altera valor documental, não inclui
ou remove pares. A validação da fase e privacidade reutiliza
applyDocumentEnrichment/persistEnrichment/validatePublishedData.
Conflito, falha ou restrição preserva o dado. Mudanças somente em
data/months, push validado sem força e publicação reutilizável
apenas se houve commit. Mantidos limite de 48 HTTP, grupo CGU,
até dois ZIPs, sem novo cron e sem arquivo bruto. O workflow recebe
permissão de escrita somente no job de coleta confirmado.
Teste e merge exigidos; reverter código não apaga dados válidos já
recuperados. Saldo contábil e RPP/RPNP continuam bloqueados.


## Recuperação de pares ausentes de pagamento — 27/11/2026

A execução 46098062917 publicou três históricos e seis componentes,
18/18 HTTP 200, nove operações em dois JSONs (433514c). No CSV de
2025-02-11, 13 pares com valorRestoPago positivo, quatro reconhecidos
e nove não correspondentes aos pares elegíveis canônicos. A ausência
pode ser do documento, da relação ou da elegibilidade; não representa
pagamento não contabilizado pelo SIAFI.

O seletor anterior ignorava pares sem correspondência. Agora separa
documento presente, ausente, ambíguo e par armazenado porém inelegível.
Somente OB/DF da UG 158459, NE integral desde 2024, origem anterior ao
pagamento, valorRestoPago positivo e quatro campos pertinentes
disponíveis no CSV sem ambiguidade entram na descoberta adicional.
Prioriza e roda grupos completos de alvos por documento, dentro de
6 documentos/16 pares, 4 históricos e 48 HTTP totais. A data
2025-02-11 ocupa uma das duas vagas no disparo por alteração de código
deste fluxo como coorte de regressão; execução manual sem data mantém
rodízio normal (retirar o foco após investigar a coorte). Sem novo cron.

Cada novo par exige cinco componentes API completos, quatro campos
CSV coincidentes, resposta API completa, sem duplicidade, todos os
pares novos individualmente confrontados e todos os legados mantidos
com os mesmos centavos e componentes previamente conhecidos. Se a
resposta tiver outro par não confrontado, não se grava o documento.
NE referenciada pode ainda não estar coletada; isso não altera a
cobertura da NE. Para pagamento ausente exige consulta de detalhe
autenticada no mesmo orçamento, normalizador existente de identidade,
UG, fase, data e valor, competência já publicada e ausência de conflito
com cobertura diária completa. Gravação conjunta documento+vínculos
em um JSON, sem modificar manifesto, preservando cobertura parcial.
A consulta de arquivo não define data de emissão. Bloqueios e
divergências ficam em contagens, nunca IDs ou valores. Sem importação
CSV, novos saldos, dedução de RPP/RPNP ou retificação de valores.
Reversão por revert; dados já recuperados permanecem sujeitos às
validações canônicas. Testes sintéticos e conferência real após merge.


## Resultado da recuperação de pagamentos ausentes e conjunto integral

Run 46099363924: no arquivo 2025-02-11, 13 pares interanuais com RP
pago positivo, 4 reconhecidos e 9 ausentes; todos os 9 documentos
de pagamento já estavam no acervo. Seis documentos selecionados,
24 campos CSV/API coincidentes, 12 HTTP 200. Cinco pares recuperados,
um documento bloqueado pela exigência de conjunto integral e três
não consultados na rodada. Cinco operações persistidas em uma
competência; publicação verificada, 26 arquivos, 698 testes.
Não está comprovada a causa específica do bloqueio anterior.

Diagnóstico discriminado de conjunto inválido, pares legados ausentes,
valores/componentes divergentes, novos pares fora do recorte, ausência
de alvo RAP positivo, complementos não confrontados ou incompletos.
Para um pagamento com par RAP positivo ausente, incluem-se na amostra
os complementos ausentes do próprio documento, inclusive do mesmo
exercício, exclusivamente se no escopo UG 158459 desde 2024, quatro
campos CSV pertinentes disponíveis, sem ambiguidade. Cada novo par
deve ter os cinco componentes autenticados e confirmação cruzada;
todo o conjunto API e os legados devem ser preservados. Um complemento
não vira RAP por associação, nem é consultado/gravado isoladamente.
Mantêm-se limites (16 pares, 6 documentos, 48 HTTP, 2 ZIPs), contadores
interanuais separados, data de regressão 2025-02-11 e sem cron adicional.
Os novos diagnósticos são contagens sem IDs ou valores. Sem retificação,
importação CSV, dedução de modalidade ou saldo. Reversão por revert.

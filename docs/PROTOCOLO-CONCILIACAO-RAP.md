# Protocolo de homologação contábil de restos a pagar — UG 158459

**Decisão superveniente de 23/11/2026:** o protocolo e o módulo de preflight são apenas referência futura, **sem integração prevista por ora com Tesouro Gerencial**. A prioridade é buscar APIs oficiais com atualização ao longo do exercício; ver [fontes candidatas por API](FONTES-API-PRIORIDADES.md). A base anual da STN não serve para o acompanhamento individual dinâmico exigido pelo Observatório.

**Estado em 23/11/2026:** especificação preparatória, **sem integração SIAFI/Tesouro Gerencial implementada**, sem fonte de saldo validada e sem indicador público homologado. Referência do trabalho: [issue #29](https://github.com/guimig/observatorio-despesas/issues/29).

## 1. Separação das evidências

| Registro | O que pode demonstrar | O que NÃO demonstra isoladamente |
| --- | --- | --- |
| Histórico CGU de item de NE | Texto da operação, data e valor da movimentação **documental** | Identidade do evento contábil, conta, RP processado/não processado, saldo |
| Campos de impacto CGU (NS/OB/DF) | Parcela documental apontada pela fonte para NE SIAFI completa | Inscrição, quitação global da NE, valor do saldo atual |
| SIAFI / Tesouro Gerencial autorizado | Inscrição, saldo e baixa em contas/granularidade adequadas, **se o demonstrativo for conciliado** | Vínculo com PNCP sem chave oficial ou que toda NS seja liquidação |
| PNCP | Contratação, contrato formal, instrumento substitutivo e seus eventos próprios | Valor pago, saldo de RP ou crédito disponível |

A referência de ordem temporal **não** constitui prova de natureza contábil: movimento em 2026 relativo a NE de 2025 não é necessariamente inscrição, pagamento, cancelamento nem estorno de RP. A rotina `src/rap-inscription-review.mjs` classifica **textos**, não operações contábeis.

## 2. Contrato mínimo de dados para uma futura importação autenticada

Antes de escrever adaptadores ou permitir a publicação, obter da CEOF um relatório autorizado e especificar, com dicionário e exemplo anonimizado:

1. **Fonte e situação da extração:** sistema, nome e identificação da consulta, versão/competência, data/hora e fuso, exercício de referência, responsável pela conciliação e escopo da UG 158459.
2. **Chaves contábeis:** UG executora, gestão quando pertinente, número integral da NE, exercício da NE, exercício da inscrição, identificador de evento/documento SIAFI e sequência temporal; não presumir identidade a partir de número abreviado.
3. **Modalidade:** RP processado (RPP), RP não processado em liquidação, RP não processado a liquidar, quando diferenciados na fonte; eventos de transferência entre estados exigem chave própria para não duplicar saldos.
4. **Eventos e contas:** código oficial do evento, conta contábil e natureza débito/crédito, data contábil, exercício de competência e significado oficialmente validado; separar inscrição, reforço/ajuste, anulação, cancelamento, pagamento e eventuais reativações.
5. **Valores:** unidade monetária, sinal, granularidade, moeda, regra de arredondamento, estado da conta e valor disponível no marco de consulta; não reconstruir saldo por soma de valores de campos CGU.
6. **Cobertura e integridade:** paginação completa, filtros utilizados, quantidade de registros, divergência/duplicidade de chaves, demonstração da fonte e total de controle na mesma data-base.

**Privacidade:** relatórios administrativos brutos não devem ser versionados no repositório público nem publicados no Pages; observar classificação de acesso, identificação de pessoas e obrigações da LGPD. Se houver integração futura, ela ficará em camada gerencial autenticada com controle de acesso e governança própria.

## 3. Matriz de conciliação proposta

A conciliação deverá ocorrer **por UG + gestão + NE integral + exercício de inscrição + modalidade contábil + data-base**. Não deduzir inscrições por mera proximidade temporal.

| Verificação | Critério mínimo de aceite | Tratamento sem evidência |
| --- | --- | --- |
| Inscrição | Evento/conta SIAFI e exercício do lançamento verificados na fonte oficial | `indisponivel` |
| Situação processado/não processado | Distinção oficialmente informada na data-base, incluindo transferências | `nao_classificado` |
| Pagamento de RP | Lançamento contábil e vinculação à inscrição conciliados | `nao_conciliado` |
| Cancelamento | Movimento contábil validado, sem confundir `ANULACAO` da NE com cancelamento de RP | `nao_conciliado` |
| Saldo a pagar | Saldo de conta ou reconciliação validada de entradas/saídas e transferências, com mesmo escopo e data-base | **não publicar** |
| Conferência | Amostras reais de RP processado, não processado, pagamento parcial, cancelamento e ajuste, com aceite da CEOF | **não homologado** |

Não somar registros N:M de NS/OB/DF, não somar PNCP a empenhos e não repetir saldos em múltiplos exercícios. Um campo oficial positivo ou zero na CGU é somente o sinal **daquela linha consultada**.

## 4. Sequência de validação e portas de publicação

1. Conferir **versões atuais** das macrofunções SIAFI 021213, 020317, 020318 e 020303 por fonte oficial, vigência, competência e tratamento de inscrição automática e alteração de exercício.
2. Disponibilizar, em ambiente institucional autorizado, demonstrativos SIAFI/Tesouro Gerencial com os campos e contas contábeis de RP, seus exercícios e espécies, sem transferência ao GitHub Pages.
3. Validar o layout (chaves, datas, natureza dos movimentos, posição de saldo, distinções RPP/RPNP), documentar casos reais e comparar com totais oficiais por exercício e UG.
4. Implementar **posteriormente** importação em camada autenticada, com testes para situações normais, zero genuíno, estorno, retificação, duplicidade, fonte parcial e indisponibilidade.
5. Somente após aceite formal da área contábil: habilitar indicador **Restos a Pagar a Pagar**, informando fonte, modalidade, período, data-base, limites de cobertura e estado de conciliação.

## 5. Fontes de consulta e limites de acesso

- [Manual SIAFI — Tesouro Nacional](https://manualsiafi.tesouro.gov.br/) (consulta atual não homologada nesta etapa).
- [Portal da Transparência — API CGU](https://api.portaldatransparencia.gov.br/swagger-ui/index.html) (evidência documental, **não razão contábil**).
- [Tesouro Gerencial — Tesouro Nacional](https://www.gov.br/tesouronacional/pt-br) (relatórios autorizados necessários à conciliação).
- [Lei 4.320/1964 — Portal da Câmara](https://www2.camara.leg.br/legin/fed/lei/1960-1969/lei-4320-17-marco-1964-376590-normaatualizada-pl.html).

Até obter o demonstrativo oficial e conferir a versão vigente do Manual SIAFI, a semântica dos rótulos CGU **permanece uma hipótese documental**, nunca uma conclusão de inscrição em RP. Reversão da etapa técnica: revert da PR que adiciona o diagnóstico; nenhum JSON financeiro é migrado.

## 6. Pré-validação estrutural de demonstrativos contábeis (23/11/2026)

O módulo puro `src/rap-accounting-preflight.mjs` foi implementado **sem acesso a arquivos contábeis reais**. Ele recebe em memória um objeto sintético/proposto com `metadata`, `rows` e `controls`. **Esse contrato é um layout de homologação do projeto, não formato confirmado do SIAFI/Tesouro Gerencial.** Não há upload, leitura automática de XLSX, cron, extração de CPF ou integração com o site público.

O cabeçalho exige sistema `SIAFI_TESOURO_GERENCIAL`, relatório, versão de regra, data de extração, data-base, UG `158459`, escopo unitário, granularidade `commitment_inscription_modality_asof` e indicação de extração integral. Os registros usam NE integral da UG com gestão de cinco dígitos, ano de inscrição não anterior ao exercício da NE, modalidade `RPP`, `RPNP_A_LIQUIDAR` ou `RPNP_EM_LIQUIDACAO`, data-base idêntica, tipo `saldo` e centavos inteiros não negativos. A distinção contábil entre as três modalidades **depende de campo oficial homologado e não é deduzida pela rotina**.

A verificação impede chaves duplicadas e compara, por exercício de inscrição e modalidade, **os saldos já informados pelo relatório** a um controle independente no mesmo recorte e na mesma data-base, incluindo registro de saldo zero. Rejeita extração incompleta, campo desconhecido, ausência de controle, data inválida, UG incorreta, NE abreviada e overflow de centavos. Só devolve status e contagens de registros/grupos, nunca montantes, identificadores ou linhas brutas; **`publishEligible:false` é obrigatório mesmo quando `ok:true`**.

Esse preflight não calcula inscrição, pagamento, cancelamento ou saldo derivado. Também não comprova independência do controle, origem do relatório, correção da classificação de contas, completude real ou aceite da CEOF; a propriedade `complete:true` da origem é apenas declaratória. Um saldo igual entre registros e controle pode decorrer da mesma base incorreta. A revisão contábil, com amostras e regras oficiais vigentes, é indispensável.

A [base de dados do Relatório de Avaliação dos Restos a Pagar](https://www.tesourotransparente.gov.br/ckan/dataset/relatorio-de-avaliacao-dos-restos-a-pagar-base-de-dados), da STN, foi localizada como fonte para **comparações agregadas**. A descrição de campos não demonstra a chave SIAFI integral nem a UG executora: `NE_CCOR` corresponde ao exercício da NE, não ao seu identificador. Por isso a base **não alimenta** automaticamente o preflight da UG 158459 e nenhum saldo por empenho será imputado a partir dela. O download da planilha e a inspeção integral das abas não puderam ser concluídos nesta etapa; revisar versão do arquivo e granularidade antes de utilizar.

**Aceite técnico:** testes Node e CI para normalidade, zero real, duplicata, estrutura ausente, sinais inválidos, controles inconsistentes, mistura de modalidades, tipos e privacidade. **Aceite contábil:** pendente de exportação oficial de TG/SIAFI com as chaves e controles citados, seguida de validação pela CEOF. Reversão: revert da PR, sem migração de dados.

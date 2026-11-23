# Dicionário de indicadores — AUD-03

Status: **proposta metodológica, não homologada**. Escopo UG 158459. Não publicar saldos definitivos sem fonte contábil apropriada e conciliação com SIAFI/Tesouro Gerencial.

| Indicador | Definição operacional | Fonte necessária | Restrições |
| --- | --- | --- | --- |
| Crédito disponível para empenho | Saldo de crédito orçamentário apto ao empenho na UG e classificação de referência | SIAFI/Tesouro Gerencial | Não calcular apenas com documentos da CGU |
| Empenho líquido | Emissão e reforços menos anulações, por exercício, UG e classificação | SIAFI; CGU como consulta documental | Não somar notas substitutivas publicadas no PNCP |
| Despesa liquidada | Montante reconhecido na fase de liquidação, considerando estornos e ajustes | SIAFI/Tesouro; CGU com cobertura | Relação NS→NE não equivale automaticamente ao total contábil |
| Despesa paga | Pagamentos e respectivos ajustes, segregados por exercício e modalidade | SIAFI/Tesouro; CGU como evidência | Pagamento pode atingir múltiplas NEs |
| RAP a pagar | Saldo de restos a pagar inscritos ainda não pagos nem cancelados, conforme situação contábil | SIAFI/Tesouro | Separar processados/não processados, exercício de inscrição e UG |
| Contratos formais | Instrumentos explicitamente classificados como contrato formal | PNCP/Compras.gov | Excluir notas de empenho substitutivas |
| Valor contratual atualizado | Valor do instrumento com alterações formais registradas | Sistema de contratos e aditivos | Não equivale a empenhado ou pago |
| Execução contratual | Obrigações executadas no âmbito do instrumento, conforme documentação de gestão | Contratos/SIAFI e registros de fiscalização | Vínculo por processo/fornecedor é apenas contextual |
| Disponibilidade financeira | Recursos financeiros disponíveis segundo classificação contábil e programação | SIAFI/Tesouro | Não confundir com saldo orçamentário ou valor pago |

## Portas de publicação

1. Identificar fórmula, unidade, exercício, granularidade e origem de cada valor.
2. Declarar se o indicador é **documental**, **contábil conciliado** ou **estimativa**.
3. Separar pagamentos do exercício de pagamentos de restos a pagar.
4. Mostrar cobertura e última atualização; sem fonte, usar indisponível, nunca zero.
5. Registrar exemplos reais e aceite da CEOF/DAP antes de habilitar indicadores financeiros como definitivos.

## Exemplos de teste conceitual

- Uma NS com duas NEs relacionadas não representa duas liquidações independentes.
- Uma OB que impacta duas NEs não deve ser integralmente atribuída a ambas.
- Uma NE que substitui o instrumento de contrato continua sendo uma NE na execução orçamentária.
- O valor publicado de um contrato não é somado aos empenhos para obter total de despesas.
- Uma NE de exercício anterior associada a pagamento atual exige análise de RAP, não classificação automática como despesa orçamentária do exercício corrente.

## Pendências de homologação

Obter relatórios SIAFI/Tesouro Gerencial autorizados, confirmar layouts e contas utilizadas, validar fórmulas e amostras com CEOF e Contratos. Esta documentação não afirma que a conciliação já foi realizada.

## Porta adicional — pré-validação de dados contábeis

Um demonstrativo SIAFI/Tesouro Gerencial submetido à rotina `src/rap-accounting-preflight.mjs` pode receber `ok:true` apenas quanto ao **formato, granularidade e controles declarados**. Esse resultado **não habilita** publicação: `publishEligible` permanece sempre `false`. O indicador RAP a pagar segue indisponível até validação das contas, da extração completa, dos saldos, da data-base e da classificação RPP/RPNP pela CEOF. A base anual do Relatório de Avaliação dos Restos a Pagar da STN, sem identidade SIAFI individual e UG executora verificadas, não fornece saldo de RAP por NE da UG 158459.

# Homologação documental da trajetória por empenho — UG 158459

## Escopo e evidências

Inspeção dos arquivos publicados em `data/months/2026-10.json` e `data/months/2026-11.json`, em 20/11/2026, com base no acervo versionado do Observatório. O resultado não constitui conciliação SIAFI nem auditoria da execução financeira integral.

| Indicador observado | Resultado |
| --- | ---: |
| Competências disponíveis | 2 (outubro e novembro de 2026) |
| Documentos distintos | 421 |
| NEs com documento no acervo | 36 |
| Relações publicadas | 175 |
| Relações com documento de origem classificado na fase 2 | 115 |
| Relações com documento de origem classificado na fase 3 | 60 |
| NEs distintas referenciadas por relações | 41 |
| NEs referenciadas sem documento da NE no acervo | 31 |
| Destas, referências a NEs de 2025 | 6 |

**Interpretação:** o histórico é parcial. A existência de vínculo documental com uma NE não demonstra a coleta do empenho original; a ausência de vínculos não demonstra ausência de liquidação ou pagamento. O total de NEs com documento e o total de NEs referenciadas não devem ser somados sem deduplicação.

## Regras de homologação

1. Uma NE pode ter várias NS e vários documentos de pagamento vinculados, inclusive em competências distintas.
2. NS e OB/DF são relacionados à NE, não diretamente entre si, pois a fonte consultada não demonstra qual NS foi quitada por qual pagamento.
3. Documentos de exercícios anteriores são mantidos como referências válidas, sem presumir que sejam restos a pagar sem comprovação adicional da inscrição.
4. Valor de NE ausente deve ser exibido como indisponível, nunca R$ 0,00.
5. Valores negativos são preservados; não se infere anulação, estorno ou cancelamento apenas pelo sinal.
6. Duplicidades documentais com valores conflitantes exigem sinalização, e não soma silenciosa.
7. As contagens e somatórios de vínculos são descritivos, não constituem saldo de empenho, liquidação, pagamento ou restos a pagar.
8. O painel não apresenta a trajetória como completa quando não há cobertura histórica comprovada.

## Pendências para homologação contábil

- Ampliar a coleta histórica de NEs, NS e documentos de pagamento, inclusive exercícios anteriores.
- Identificar fontes oficiais que permitam verificar inscrição, cancelamento e pagamento de restos a pagar.
- Verificar documentos reais com múltiplas NEs impactadas e rateio de valores, antes de produzir indicadores de quitação.
- Estabelecer conciliação com SIAFI/Tesouro Gerencial, caso haja acesso e autorização institucional.
- Evitar inferência de contrato formal a partir de nota de empenho substitutiva.

### Rastreabilidade integrada — revisão 27/11/2026
A identidade financeira integral permanece a única prova para agregação por instrumento. NE abreviada, unidade administrativa, processo, CNPJ e valor compatíveis (sem concorrentes locais) produzem candidato de alta confiança; registros contextuais PNCP não exigem PI e data de listagem CGU não equivale à emissão declarada PNCP. A ausência de coincidência de data não exclui candidato. Valores de candidatos nunca são agregados. Cruzamentos por item são possíveis com instrumento único forte, rotulados candidatos, sem rateio de NS/OB ou saldo de ata. O índice derivado relationship-index.json contém somente IDs públicos e competências, sem textos ou valores; consulta direcionada tem fallback para histórico. Filas existentes priorizam impactos CGU já relacionados sem valor, NEs de referências de identidade e atas específicas faltantes, com cotas mantidas. Catálogo de licitações de origem inclui controles de ata da Reitoria. Referências externas ficam como links, não há importação indiscriminada de outros órgãos. A sondagem CGU de licitações/contratos permanece apenas leitura, sem confirmar identidade PNCP até homologação. Reverter o PR remove a camada derivada sem migrar a base. Nenhum PDF é coletado.

A recuperação reversa de instrumentos do IFC encontrados em atas usa IDs PNCP integrais e reserva até 1/4 do lote já existente de consultas diretas. Somente instrumentos do IFC a partir de 2024 entram no catálogo, por detalhe normalizado; o mês recebe cobertura parcial, nunca integral. Compras/atas de órgãos externos ficam como referências externas, não como publicações próprias do IFC. Referências integrais de NE no PNCP também entram na recuperação CGU por ID; candidatos abreviados não. O localizador de relacionamentos é vinculado ao carimbo do manifesto e, em caso de inconsistência de publicação, a aplicação usa a consulta histórica.

### Relação direta de contrato CGU com NE
A sondagem de 27/11 recuperou três NEs integrais de Araquari associadas a um contrato CGU. O coletor de evidências positivas consulta contratos do IFC por janelas mensais e IDs oficiais, preserva somente identidade administrativa mínima e NEs integrais da UG 158459 desde 2024. Não publica valores, observações, dados de pessoa física ou respostas brutas; não afirma completude das consultas. Checkpoints negativos ficam em cache. A ficha CGU é independente dos instrumentos PNCP: a comparação de número/processo/CNPJ/assinatura/unidade, quando única, é somente candidata entre fontes e não altera os agregados financeiros PNCP. NEs integrais ausentes entram na recuperação por código. O reverso consiste em retirar o código e o JSON mínimo derivado da fonte, sem alterar os catálogos financeiros. Push de dados com arquivos pendentes de stage é bloqueado antes da publicação.

### Consolidação da execução por contrato CGU
As fichas CGU apresentam subtotais dos itens de NEs integralmente conciliadas (inclusão, reforço, anulação, cancelamento RAP, reconstrução) e impactos por NE em liquidações/pagamentos quando o documento é único e consultado. NEs ausentes, compartilhadas entre contratos CGU ou com conflitos não são alocadas. Cada grupo tem contagens próprias; zero sem evidência é indisponível. Movimentos agrupados por mês do evento e impactos pelo mês da data documental de referência, nunca pelo saldo/baixa contábil. O índice de competências permite carregar somente meses pertinentes sob demanda. A fila financeira reserva parte da priorização existente para documentos relacionados a NEs integrais de contratos CGU, com rodízio, sem aumentar orçamento. O detalhe CGU /contratos/id usa objeto validado pela identidade, enriquece campos sem apagar referências positivas; consultas Contratos.gov mantêm diagnóstico por contagens de NEs comuns, não equivalência de IDs. A remoção do código de apresentação/planejamento reverte a camada sem migração da base.

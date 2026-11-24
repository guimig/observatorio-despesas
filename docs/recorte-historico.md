# Recorte temporal do Observatorio

Inicio fixo: 01/01/2024 (inclusive). Fim: dia corrente, com a CGU consultando dias encerrados no fuso de Brasilia, e PNCP consultando publicacoes ate a data permitida pela fonte. O corte vale para recuperacao documental, inclusive buscas manuais por data e buscas de origem por ID. Referencias a NEs de exercicios anteriores permanecem nos documentos posteriores ao corte, sem recuperar sua origem nem inferir saldo de RAP. Nao ha exclusao de dados ou reescrita do Git.

- CGU: dois lotes de ate cinco dias por dia; cobertura por fase e data, incluindo competencias ausentes e lacunas do mes corrente. Rodizio de competencias impede que uma falha permanente retenha toda a fila. Recuperacao individual inclui NEs do mesmo exercicio e interanuais de 2024 em diante.
- PNCP/Compras.gov: coletas correntes preservadas, uma rodada historica diaria por catalogo. Consultar mes incompleto, priorizar competencias nunca tentadas, nao repetir fonte/modalidade ja completa na rodada historica. Falhas continuam pendentes; cobertura completa nao e sinonimo de conciliacao financeira.
- Os 15 fluxos de coleta que compartilham observatorio-coleta-main usam fila sequencial max, sem gravacoes concorrentes. O limite do GitHub e de 100 execucoes pendentes.
- Datas de publicacao de contratos anteriores a 2024 retornadas incidentalmente em delta posterior nao entram em fila de recuperacao de origens. Vinculos a objetos anteriores ao corte podem permanecer como referencias, sem fetch pontual anterior.
- Sem Tesouro Gerencial, sem snapshots redundantes e sem tolerancia minima para alteracoes materiais.

O recorte e uma politica de recuperacao, nao declaracao de cobertura ja completa. Revisao periodica de documentos completos, limites de API e lacunas de fontes ainda exigem monitoramento.

## Revisao de cobertura completa

Uma rodada diaria independente revisa ate quatro fases de dias anteriores a janela corrente de sete dias. Prioriza NEs impactadas por liquidacoes/pagamentos recentes e reserva capacidade para demais documentos. Intervalos de elegibilidade: 7 dias para NEs ativas, 30 para fases com documentos, 90 para fases vazias. Novo impacto posterior a consulta torna a fase novamente elegivel. Nao e SLA: a capacidade e limitada e as APIs podem falhar. Estado por data/fase, cache descartavel com limites comuns. A listagem oficial por emissao/fase e usada em vez de atribuir data de emissao pelo detalhe CGU ambiguo; desaparecimento de registro confirmado, erro ou retorno parcial e tratado como conflito, nao como anulacao. Mudancas de valor invalidam enriquecimentos conforme o fluxo canonico.

## Dimensionamento adaptativo e telemetria

Nos dois disparos agendados, a recuperação histórica planeja até 21 dias de várias competências e encerra o lote ao atingir 120 tentativas HTTP, oito minutos de orçamento de novas chamadas ou bloqueio 401/403/429. Uma sequência de três erros de transporte/5xx também interrompe novas consultas. Intervalo interno de 1,5 s entre chamadas, inclusive retries e consultas de impacto. Estes são limites conservadores do projeto, não cotas declaradas da CGU; uma requisição já iniciada pode terminar depois do orçamento temporal. O modo manual mantém a seleção por competência e até sete dias. Resumo por execução: dias, fases, documentos, chamadas, categorias HTTP e tempo, sem novo histórico persistente. Quando a main muda durante a coleta, backfill e delta PNCP podem retentar o push uma única vez, somente com arquivos de dados disjuntos e validação após rebase; conflito no mesmo arquivo interrompe sem sobrescrever dados.

## Fechamento mensal e painel de cobertura

A pagina inicial carrega sob demanda o resumo de cobertura desde 01/01/2024, gerado exclusivamente no dist/ a partir dos JSONs canonicos validados. Nao versionar o indice, nao duplicar documentos e nao armazenar payloads. Data documental, ultima gravacao, data de revisao registrada e janela de delta PNCP sao distintos; o cache descartavel nao e prova publica da ultima consulta de cada registro. Mes sem arquivo permanece sem cobertura, nao despesa zero.

A cobertura de contratos e licitacoes por mes fechado exige `closedMonth:true` obtido em consulta completa de competencia ja encerrada. A consulta integral do mes em andamento ou um checkpoint legado sem essa evidencia volta a fila de fechamento. Aditivos, cancelamentos e saldos nao sao inferidos.

Metas propostas para homologacao: cobertura de todos os dias encerrados nas tres fases; zero lacunas de NEs em escopo sem causa documentada; contabilizar separadamente vinculos, itens e historicos pendentes; contratos/licitacoes com fechamento por fonte/modalidade. Enquanto isso, rotular cobertura parcial. O indice nao garante SLA nem prova conciliacao. Aferir desempenho em desktop/mobile e com acervo maior antes da homologacao final.

## Enriquecimento multicompetencia

Os limites por tipo de consulta continuam globais por rodada; distribuir entre meses em vez de limitar a um mes, intercalar tipos para nao deixar pagamentos ou historicos sempre para o final e reservar dois slots por tipo para reconsulta de vinculos/itens confirmados a cada 30 dias. O mesmo cache de historicos guarda hashes por documento e tipo; consultas identicas nao alteram JSON. Chamadas de todas as paginas e tentativas compartilham o orcamento de 120 requisicoes/8 minutos e espacamento minimo de 1,5 s; em caso de limite, tarefas nao executadas permanecem elegiveis. Respostas vazias conflitantes ou itens confirmados omitidos exigem revisao; nunca presumir anulacao/ausencia. Backfill em push tambem utiliza o orcamento adaptativo; as tres datas pendentes da issue #88 recebem prioridade somente enquanto incompletas.

## Diagnostico Compras.gov (issue #13)

Em 24/11/2026, o workflow [45479696373](https://github.com/guimig/observatorio-despesas/actions/runs/45479696373) confirmou HTTP 200 e uma UASG para 158459 com `statusUasg=true`, HTTP 404 sem esse parametro, e HTTP 200 para a UASG de controle 158125. O cadastro oficial retornou codigoOrgao 26422; a coleta nao presume que UO e codigo de orgao sejam equivalentes. O adaptador usa a consulta documentada com status ativo e mantem a verificacao de identidade. A sondagem contratual anterior nao incluiu as datas obrigatorias; a nova usa as mesmas janelas de vigencia do coletor em tres competencias do recorte, sem persistir respostas. HTTP 404 permanece indisponibilidade/ausencia nao comprovada, nunca zero contratos. Fonte: [Manual oficial da API Compras.gov.br, secoes 8.1 e 12.1](https://www.gov.br/compras/pt-br/acesso-a-informacao/manuais/manual-dados-abertos/manual-api-compras.pdf).

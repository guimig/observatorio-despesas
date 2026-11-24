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

# Plano diretor v0.2 — Observatório de Despesas Públicas

Revisão de 22/11/2026. **Plano executável**, sujeito a validação funcional, jurídica e contábil. A `UG 158459` é o Campus Araquari; a `UO 26422` é o IFC institucional, e não um sinônimo da UG. Este projeto **não** é sistema oficial nem substitui SIAFI/Tesouro Gerencial.

## Decisão de produto

Duas camadas logicamente independentes, sem criação prematura de banco/backend:

1. **Observatório público** (GitHub Actions, Node 22, JSON mínimo, GitHub Pages): evidência documental CGU, processos, licitações, contratos formais, empenhos substitutivos, atas e qualidade/cobertura. Sem dados restritos nem segredos no cliente.
2. **Futura camada gerencial autenticada**: orçamento, disponibilidades, exigibilidades, programação financeira, gestão interna CEOF e conciliação SIAFI. Depende de permissões, governança e fonte homologada. Não criar integração autenticada em GitHub Pages.

O EmailBackupHub e os relatórios do Tesouro Gerencial continuam projetos independentes. Eventual série histórica de UO 26422 e UG 158459 e correção por índices exige identificação da fonte, fórmula, deflator, ano-base, periodicidade e evidência de completude.

## Regras inegociáveis

- Não somar contratos, atas ou valores de licitação com NE/NS/pagamentos. Nota de empenho substitutiva não é termo contratual.
- Não equiparar crédito, provisão, empenho líquido, liquidação, pagamento, financeiro disponível, restos a pagar e saldo contratual.
- Não deduzir quitação NS→OB/DF sem relação oficial; usar NE como eixo dos vínculos CGU, inclusive N:M.
- Não classificar anulação, reforço, estorno, inscrição/cancelamento de RAP apenas por sinal ou espécie de documento.
- Publicação institucional PNCP/Reitoria não prova execução pela UG 158459; processo 23349 é indício, não evidência definitiva.
- Falha de API, ausência de documento e mês sem arquivo **não significam gasto zero ou irregularidade**.
- Indicadores devem exibir período, UG/UO, fonte, data de atualização, cobertura, método e grau de evidência.
- CPF integral, dados internos e credenciais não entram em JSON, logs, artefato público, frontend ou Git.
- Alterações de schema/coletores exigem testes, PR, validação, merge e conferência de publicação. Não reescrever histórico Git ou multiplicar snapshots.

## Linha de base: 22/11/2026

Fotografia do acervo versionado antes deste replanejamento (não representa completude):

- CGU: três competências parciais (2025-12, 2026-10, 2026-11); 980 documentos, 493 relações, 30 datas com três fases completas.
- NEs: 52 documentos originais; 70 notas distintas referenciadas, 47 ainda não localizadas no acervo; 679 operações de enriquecimento pendentes.
- PNCP: 62 publicações licitatórias, 70 instrumentos no catálogo de novembro (9 termos formais; 61 NEs substitutivas), 473 atas de 24 procedimentos e 391 itens de oito licitações.
- Compras.gov: consulta cadastral da UASG 158459 retornou HTTP 404; **fonte indisponível**, não catálogo vazio.
- Testes e deploy automatizados existentes; auditoria/amostragem contratual ainda não equivale a homologação jurídica ou contábil.

Estas quantidades são instantâneas. Para uma fotografia atual, execute `npm run audit:baseline` e verifique os resumos de cobertura por data/competência e as execuções de Actions.

## Marcos, dependências e critérios de aceite

| Ordem | Marco | Entrega mínima | Porta de qualidade |
| --- | --- | --- | --- |
| P0-A | **v0.2/Auditoria e governança** | Inventário de código/fontes, baseline reproduzível, AGENTS.md, riscos, issues atualizadas | CI íntegra; auditoria de dados sem identificadores pessoais; fontes diferenciadas |
| P0-B | **v0.2/Histórico CGU** | Cobertura real por mês/dia/fase, recuperação retomável, NEs referenciadas, enriquecimento proporcional | Aumentar dias completos; reduzir lacunas e pendências por exercício; respeitar limites CGU |
| P1-C | **v0.2/Contratações** | Histórico PNCP, reconsulta de atualizações, atribuição UG verificável, itens/resultados/atas | Sem dupla contagem; amostras de vínculos oficiais auditadas; erros de API visíveis |
| P1-D | **v0.2/Experiência pública** | Consulta e filtros integrados; fontes/cobertura visíveis; páginas responsivas; índices sob demanda | Desempenho medido; usabilidade; exportações com proteção contra formula injection |
| P2-E | **v0.3/Contabilidade** | Fontes oficiais para créditos, NE líquida, liquidado/pago e RAP a pagar | Reconciliação com SIAFI/Tesouro e aceite da CEOF; sem cards monetários definitivos antes disso |
| P2-F | **v0.3/Operação** | Documentação, observabilidade, retenção, alerta e recuperação | Aprovação de responsabilidades, segurança e procedimentos de contingência |

Etapas P0-A e P0-B são prioridade imediata; P1-C pode avançar em paralelo sem competir pelo limite CGU. As demais **não** estão homologadas só porque existem componentes de interface ou testes unitários.

## Recuperação histórica — política operacional

- Checkpoint por `data/months/AAAA-MM.json`, sem nova base ou arquivo bruto. `data/manifest.json` contém somente competências publicadas.
- Priorizar lacunas de NEs referenciadas e, alternadamente, competências recentes. Período-base inicial `2025-01`; ampliar anos apenas com disponibilidade comprovada.
- Um agendamento diário (`11:13` UTC), com lote conservador de **três dias**; execução manual aceita de um a sete dias. A expansão para dois lotes diários **fica condicionada ao diagnóstico das falhas observadas em 22/11/2026**, quando os três dias tentados (14 a 16/10) falharam. Não aumentar ritmo enquanto a causa for desconhecida.
- Antes de ampliar mais, registrar duração, falhas HTTP, taxa de dias válidos por lote, ocupação da fila compartilhada e crescimento do repositório por pelo menos alguns ciclos.
- `npm run audit:baseline` produz JSON de linha de base. `node src/diagnose-coverage.mjs --audit-md` produz Markdown sem NEs individuais. O relatório considera **meses ainda sem arquivo e todos os dias encerrados**; dia parcialmente consultado difere de dia ausente.
- O trabalho histórico não encerra até que o intervalo declarado esteja integralmente coberto ou que cada lacuna esteja explicitamente justificada. Cobertura da consulta não é enriquecimento nem conciliação contábil.

## Revisões do modelo/integrações

1. Reconsultar PNCP conforme atualização oficial de registros; não depender apenas do mês de publicação. Verificar páginas, exclusões e versões, preservando trilha de proveniência.
2. Validar valor global/inicial/atualizado e aditivos com fonte apropriada. Campo presente ou nulo em amostra PNCP não é homologação de saldo contratual.
3. Expandir itens, resultados, fornecedores PJ e participantes de atas **somente** com identificadores oficiais. Quantitativos institucionais não representam distribuição física de campus.
4. Modelar operações de NE, estornos e RAP por evento **após** confirmar semântica SIAFI/CGU; não publicar saldo suposto.
5. Investigar HTTP 404 de Compras.gov por documentação/endpoint alternativo. Falha não remove o catálogo PNCP válido.
6. Considerar índice estático incremental para consulta ao crescer o histórico; não adicionar infraestrutura permanente antes de medir necessidade.

## Fora da primeira versão consolidada

Saldo de ata; saldo contratual inferido; detecção automática de irregularidade; dedução de NS quitada por OB; atribuição presumida de compras centrais; indicadores financeiros oficiais sem conciliação; integração privada sem autorização; SIOP/SIDRA sem indicador prioritário; banco grande ou backend novo sem limitação comprovada.

## Evidências e acompanhamento

- [Auditoria fase 1](AUDITORIA-FASE-1.md)
- [Modelo conceitual](MODELO-CONCEITUAL-DESPESAS.md)
- [Dicionário preliminar de indicadores](DICIONARIO-INDICADORES.md)
- [Arquitetura](ARQUITETURA.md)
- [Recuperação de NEs antigas](RECUPERACAO-NE-HISTORICAS.md)
- [Regras de atribuição de campus](AUDITORIA-ATRIBUICAO.md)
- [Atas, itens e participantes](ATAS-REGISTRO-PRECOS.md)

**Revisão gerencial:** após cada grupo de entregas, registrar SHA, amostra validada, cobertura, limitações, testes, rollback e decisão explícita sobre prosseguir. Nenhum indicador financeiro torna-se homologado automaticamente por passar na CI.

## Incremento técnico — isolamento e rotação CGU (22/11/2026)

O backfill passa a gravar checkpoints por **dia/fase**: se uma fase falhar, as fases que tiveram coleta e validação bem-sucedidas são preservadas; em nova execução apenas as fases pendentes são reconsultadas. Execuções agendadas percorrem datas pendentes com rotação circular, sem suprimir erros persistentes ou modificar o limite de três dias por lote. Chamadas manuais preservam a ordem sequencial. Isso evita perda de trabalho e ajuda a identificar dados problemáticos, mas **não resolve por si só a causa material** das falhas da CGU. A issue #88 permanece aberta até validação real de estabilidade e diagnóstico de datas problemáticas.

## Colisões de identificador SIAFI entre datas ou fases (22/11/2026)

A recuperação real encontrou rejeição por **documento público inválido ou duplicado** ao tentar gravar a fase 3 em 08/12/2025 (run 45057655056). Como o normalizador CGU já valida o formato SIAFI e a data da consulta, a duplicidade no acervo mensal é uma hipótese fortemente sustentada pela validação no armazenamento. Não se atribui automaticamente culpa à API nem se escolhe qual registro prevalece.

Antes de cada gravação, o coletor compara os documentos da fase com os identificadores já existentes naquela competência. Se o mesmo ID estiver associado a **outra data** ou **outra fase**, a fase inteira é rejeitada sem alterar o checkpoint. O log informa só data da consulta, fase, categoria do conflito e **quantidade de IDs conflitantes**, sem publicar os próprios identificadores. A coleta continua nas demais fases/datas. A fase rejeitada permanece sem cobertura válida e será reconsultada no futuro; o sistema não elimina documentos, não infere valores zero e não marca sucesso indevido.

A solução final da colisão ainda exige estudar o retorno real, a data e a espécie do documento e a semântica de fase na CGU/SIAFI. Não resolver por descarte silencioso, escolha da data mais recente ou redistribuição de valores sem evidência oficial. A issue #88 permanece aberta.

## Avanço P0-B — identidade única e aparição por fase

A camada documental passa a diferenciar **identidade SIAFI canônica** de **aparição adicional no resultado da consulta de outra fase CGU**, mantendo compatibilidade com o JSON mensal atual. O Observatório registra quantidades e discrepâncias de valor como evidência de qualidade; não cria documentos, pagamentos ou liquidações em dobro. Totais monetários de fases com sobreposição ficam indisponíveis até conciliação. A etapa P0-B só poderá ser homologada quando a documentação oficial e uma amostra real esclarecerem a semântica desses retornos, além da cobertura histórica exigida.

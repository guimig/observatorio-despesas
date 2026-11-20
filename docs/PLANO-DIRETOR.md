# Plano diretor de evolução — Observatório de Despesas IFC Araquari

Status: plano de implementação, sujeito a homologação funcional e contábil. Escopo inicial: UG 158459 (Campus Araquari); UO 26422 (IFC) é dimensão institucional distinta.

## Objetivo
Evoluir a aplicação pública de rastreabilidade documental para uma ferramenta integrada de acompanhamento orçamentário, financeiro, contratual e de compras/licitações. O site público não é SIAFI, Tesouro Gerencial nem sistema institucional oficial.

## Princípios e critérios inegociáveis
- Não somar contratos e empenhos; distinguir contrato formal de nota de empenho que substitui instrumento contratual.
- Não equiparar valor empenhado, liquidado, pago, crédito recebido, disponibilidade financeira e saldo contratual.
- Distinguir despesas do exercício de restos a pagar processados e não processados, inscrição, cancelamento e pagamento.
- Não inferir vínculo documental por coincidência de valor, fornecedor ou data. Indícios contextuais devem ter etiqueta própria.
- Ausência de registro ou falha de API não é zero nem evidência de irregularidade.
- Toda métrica deve expor fonte, UG/UO, período, cobertura, atualização, regra e grau de evidência.
- Dados restritos jamais entram no artefato público do GitHub Pages; integrações internas exigem autorização e autenticação.

## Módulos-alvo
1. Visão geral: panorama de créditos, execução, RAP, contratos e compras.
2. Orçamento: dotação, provisões, créditos adicionais, bloqueios e disponibilidade.
3. Execução da despesa: NE, liquidação, pagamentos, anulações, reforços, saldos e vínculos.
4. Financeiro: exigibilidade, programação, pagamentos e controles CEOF.
5. Contratos: somente instrumentos formais na tabela principal; vigências, alterações e execução.
6. Compras e licitações: planejamento, processos, PNCP, SRP, atas, adesões e resultados.
7. Relatórios: filtros transversais, séries, exportações e alertas.
8. Qualidade: cobertura, divergências, proveniência, falhas e documentação.

## Fases e portas de qualidade
| Fase | Entrega | Aceite |
| --- | --- | --- |
| 1. Auditoria (1–2 semanas) | Inventário, matriz de fontes, riscos, linha de base e backlog | Evidências e testes de referência registrados |
| 2. Modelo (2–3 semanas) | Entidades, chaves, cardinalidades, dicionário de métricas | Exemplos reais validados com DAP/CEOF/Contratos |
| 3. Orçamento e financeiro (3–5 semanas) | Adaptadores oficiais autorizados e indicadores reconciliados | Conciliação por UG, exercício e natureza |
| 4. Contratos (3–4 semanas) | Catálogo formal sem duplicação de NEs | Vínculos verificáveis e vigências rastreáveis |
| 5. Compras (3–5 semanas) | Processos, editais, atas, SRP e fluxo de demandas | Trajetória rastreável da demanda ao instrumento |
| 6. UX e relatórios (2–4 semanas) | Navegação modular, filtros e exportações | Testes de uso e acessibilidade |
| 7. Alertas (2–4 semanas) | Vencimentos, prazos e divergências | Alertas auditáveis, poucos falsos positivos |
| 8. Homologação (2–3 semanas) | Manual, testes integrados e operação | Responsáveis, segurança e contingência definidos |

Fases podem se sobrepor; prazos são estimativas, não cronograma aprovado.

## Arquitetura incremental
Preservar Node.js, GitHub Actions, JSONs canônicos por competência e GitHub Pages para a camada pública enquanto volume e desempenho permitirem. Separar conectores, modelo canônico, regras de conciliação, indicadores e interface. Não criar banco permanente sem necessidade demonstrada. Controles gerenciais com dados restritos devem residir em camada autenticada independente.

## Política de implementação
Cada fase deve gerar issues pequenas, testes automatizados, documentação de regra e validação funcional. Usar branch, PR, CI, merge e verificação de Pages. Nenhuma métrica financeira é considerada homologada apenas por passar em testes de software.

## Documentos de execução
- [Auditoria da fase 1](AUDITORIA-FASE-1.md)
- [Modelo conceitual existente](MODELO-CONCEITUAL-DESPESAS.md)
- [Arquitetura existente](ARQUITETURA.md)

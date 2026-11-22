# Instruções de manutenção — Observatório de Despesas Públicas

Estas instruções orientam contribuições humanas ou automatizadas (incluindo ChatGPT/Codex). **O código e os dados da `main` são a fonte do estado implementado**; documentos podem registrar propostas ainda não executadas.

## Antes de alterar
1. Ler `README.md`, `docs/PLANO-DIRETOR.md`, `docs/MODELO-CONCEITUAL-DESPESAS.md`, `docs/DICIONARIO-INDICADORES.md`, o código da função afetada e testes correspondentes.
2. Identificar dados reais, limites de cobertura e chave de relacionamento; não inventar evidência, saldo ou vínculo.
3. Fazer alterações pequenas e reversíveis em branch, abrir PR e conferir CI/deploy. Não editar produção diretamente sem necessidade.

## Conceitos obrigatórios
- `UG 158459`: execução SIAFI de Araquari. `UO 26422`: orçamento institucional IFC. `UASG 158125`: publicação central da Reitoria em vários processos. Nunca confundir.
- PNCP registra termos formais e instrumentos substitutivos, inclusive notas de empenho. Tabela de contratos formais **exclui** notas substitutivas; uma mesma NE não pode inflar totais por sua publicação PNCP.
- Relações documentais CGU podem ser N:M. `NS -> NE` e `pagamento -> NE` não autorizam inventar aresta direta `NS -> OB/DF`.
- Créditos, provisionamentos, NE líquida, liquidação, pagamentos, saldo contratual, RAP e disponibilidade financeira são conceitos diferentes.
- Falha, HTTP 404, consulta incompleta ou ausência no catálogo não significam resultado zero, inexistência de despesa ou irregularidade.
- Campo textual, CNPJ, CPF e nomes devem respeitar a minimização e a política `src/privacy.mjs`. **Nunca** publicar CPF integral, segredo, resposta bruta ou dados internos em Pages.

## Arquitetura
- Node.js 22; `src/` para adaptadores/normalização/armazenamento; `data/` somente JSON canônico mínimo; `assets/` interface; `test/` testes; GitHub Actions orquestra segredo e deploy.
- Preferir evoluir JSON e arquivos por competência com checkpoint estável. Não adicionar banco, dependência ou serviço externo sem justificar limitação técnica concreta.
- Preservar idempotência, pagination completa, validação e reconsultas controladas; distinguir falha de fonte de consulta vazia completa.
- Alterações financeiras devem ter fórmula, fonte, unidade, granularidade, cobertura, testes e validação contábil antes de publicar totais conclusivos.

## Validação antes do merge
Executar `npm run check:syntax`, `npm test`, `npm run check:data`, `npm run build:site`, `npm run backfill:plan`. Para mudança de coletor, testar sucesso, resposta parcial, timeout/falha e repetição sem duplicata. Verificar Actions e Pages após merge. Não declarar testes locais ou deploy sem comprovante.

## Backlog e homologação
Marcos e limites: `docs/PLANO-DIRETOR.md`. Issues abertas mostram pendências de dados **mesmo se a estrutura de código existir**. Registrar nos PRs o que foi testado, o que não foi e instruções de rollback. O site é independente e não substitui fonte oficial.

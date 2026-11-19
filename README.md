# Observatório de Despesas Públicas

Aplicação pública independente para consulta e rastreabilidade de documentos de despesa do IFC. **Escopo inicial:** UG 158459 (IFC Araquari); a UO 26422 corresponde ao IFC como um todo e não deve ser confundida com a UG.

## Situação

Projeto em implantação por etapas. Primeiro módulo: documentos de empenho, liquidação e pagamento do **Portal da Transparência/CGU**, com armazenamento mensal incremental, controle de cobertura, testes e interface estática. Dados do SIOP, SIDRA, PNCP, Compras.gov.br e fontes complementares serão integrados progressivamente.

O projeto não consulta, altera nem substitui os relatórios do Tesouro Gerencial e não depende do EmailBackupHub. Nenhum dado histórico é considerado completo antes da coleta e da validação correspondentes.

## Segurança e privacidade

- **CPF sempre mascarado:** `***.123.456-**` (somente os seis dígitos centrais). Nunca versionar ou publicar CPF integral.
- CPF mascarado não é chave única de pessoa; dados pessoais devem ser minimizados.
- Não gravar respostas brutas das APIs, tokens, `.env` ou logs com dados pessoais.
- Identificadores de documentos SIAFI e relações entre documentos devem ser validados.
- O token da CGU deve ser salvo **neste repositório** como GitHub Actions repository secret `CGU_API_KEY`; Secrets de outros repositórios não são compartilhados.
- A API autenticada somente é chamada pelo GitHub Actions, nunca pelo navegador.

## Como executar

Requer **Node.js 22 ou superior**. Nenhuma dependência de terceiros é necessária para o primeiro módulo.

```bash
npm test
npm run check:data
# opcional, com CGU_API_KEY no ambiente e SEM copiar o valor para logs:
npm run collect:cgu
```

O coletor consulta apenas uma janela recente configurável (`CGU_LOOKBACK_DAYS`, padrão 7) e grava arquivos mensais em `data/months/`, com `data/manifest.json` como índice. Um período incompleto **não** é apresentado como total definitivo. A coleta é idempotente e só altera arquivos quando o conteúdo canônico muda.

## Publicação

A interface estática usa o `index.html` na raiz. Após o primeiro merge, habilite GitHub Pages em **Settings → Pages → Deploy from a branch → main → /(root)**. A URL prevista é `https://guimig.github.io/observatorio-despesas/`. Isso não habilita o token: ele deve ser configurado separadamente em Settings → Secrets and variables → Actions.

A coleta tem workflow próprio, separado da validação de PR. Sem o Secret `CGU_API_KEY`, a rotina de atualização é ignorada, sem publicar informações artificiais.

## Estrutura

- `src/`: adaptador CGU, normalização, privacidade, armazenamento incremental e validação
- `test/`: testes automatizados de coleta, esquema, idempotência e privacidade
- `data/`: somente dados públicos normalizados e minimizados
- `assets/`: interface da aplicação
- `.github/workflows/`: CI de validação e coleta isolada

## Desenvolvimento

1. Fundação, ingestão CGU e consulta documental (em desenvolvimento).
2. Vínculos NE–NS–pagamentos e fichas detalhadas.
3. Favorecidos, processos, itens, PNCP/Compras.gov.br e índices SIOP/SIDRA.
4. Séries históricas completas, relatórios, qualidade e exportações.

A vinculação de fontes só deve ser exibida como confirmada quando houver chave documental verificável. Valores em centavos inteiros; ausência de dados é `null`, nunca zero presumido.

> Projeto experimental, independente de publicação ou decisão oficial do IFC.

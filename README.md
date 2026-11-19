# Observatório de Despesas Públicas

Aplicação pública independente para consulta e rastreabilidade de documentos de despesa do IFC. **Escopo inicial:** UG 158459 (IFC Araquari); a UO 26422 corresponde ao IFC como um todo e não deve ser confundida com a UG.

## Situação

Projeto em implantação por etapas. Primeiro módulo: documentos de empenho, liquidação e pagamento do **Portal da Transparência/CGU**, com armazenamento mensal incremental, controle de cobertura, testes e interface estática. A primeira expansão inclui identificação segura de favorecidos, processos e classificação da despesa. Dados do SIOP, SIDRA, PNCP, Compras.gov.br e fontes complementares serão integrados progressivamente.

O projeto não consulta, altera nem substitui os relatórios do Tesouro Gerencial e não depende do EmailBackupHub. Nenhum dado histórico é considerado completo antes da coleta e da validação correspondentes.

## Segurança e privacidade

- **CPF sempre mascarado:** `***.123.456-**` (somente os seis dígitos centrais). Nunca versionar ou publicar CPF integral.
- CPF mascarado não é chave única de pessoa; dados pessoais devem ser minimizados.
- Pessoa jurídica: CNPJ e denominação pública registrados em catálogo mensal sem duplicação por documento. Pessoa física: somente CPF mascarado; nomes não são persistidos.
- Observações textuais livres da CGU ainda não são publicadas, por poderem conter outros identificadores pessoais.
- Não gravar respostas brutas das APIs, tokens, `.env` ou logs com dados pessoais.
- Identificadores de documentos SIAFI e relações entre documentos devem ser validados.
- O token da CGU deve ser salvo **neste repositório** como GitHub Actions repository secret `CGU_API_KEY`; Secrets de outros repositórios não são compartilhados.
- A API autenticada somente é chamada pelo GitHub Actions, nunca pelo navegador.

## Como executar

Requer **Node.js 22 ou superior**. Nenhuma dependência de terceiros é necessária para o primeiro módulo.

```bash
npm test
npm run check:data
npm run build:site        # gera dist/ com interface e JSONs publicos
npm run enrich:plan       # simula itens e vínculos de pagamentos pendentes
npm run backfill:plan     # simula proximo lote de dias do mes anterior
# opcional, com CGU_API_KEY no ambiente e SEM copiar o valor para logs:
npm run collect:cgu
```

O coletor consulta apenas uma janela recente configurável (`CGU_LOOKBACK_DAYS`, padrão 7) e grava arquivos mensais em `data/months/`, com `data/manifest.json` como índice. Um período incompleto **não** é apresentado como total definitivo. A coleta é idempotente e só altera arquivos quando o conteúdo canônico muda.

## Publicação por GitHub Actions

**Ação necessária no repositório:** em **Settings → Pages → Build and deployment → Source**, selecionar **GitHub Actions** (não `Deploy from a branch`). O workflow `.github/workflows/publicar-pages.yml` realiza o build e o deploy de um artefato que inclui **somente** `index.html`, `assets/`, `.nojekyll`, `data/manifest.json` e os JSONs mensais explicitamente listados no manifesto.

A publicação ocorre por `push` em alterações de código/arquivos do site ou por **Actions → Publicar Observatório → Run workflow**. Após uma coleta que efetivamente modificar JSONs, a rotina de coleta **chama diretamente** o workflow reutilizável de Pages. Isso é importante porque pushes produzidos pelo `GITHUB_TOKEN` não acionam, em geral, outros workflows de `push`. Coleta e publicação têm grupos de concorrência separados, garantindo ordem de deploy.

Site: `https://guimig.github.io/observatorio-despesas/`. O Secret `CGU_API_KEY` é exclusivo do coletor e **nunca é necessário no workflow de Pages**.

Sem `CGU_API_KEY`, a coleta é ignorada, sem publicar informações artificiais.

## Coleta histórica incremental

O workflow `.github/workflows/backfill-cgu.yml` faz a recuperação em **lotes pequenos** (padrão três dias, máximo sete dias por execução). O mês padrão é o **mês anterior em America/Sao_Paulo**; é possível escolher qualquer competência como `2026-10` usando **Actions → Recuperar histórico CGU → Run workflow**. Ele também executa lotes agendados às segundas e quintas.

Ao iniciar, o planejador examina `data/months/AAAA-MM.json` e seleciona somente dias sem três fases completas e válidas; a cobertura existente atua como **checkpoint**. Repetir a ação avança nos próximos dias, sem duplicar documentos. `start_day` permite retomar uma faixa específica, e `recheck` força uma nova consulta de período já considerado completo. O histórico precisa de sucessivos lotes e só será tratado como íntegro se todos os dias elegíveis forem consultados com sucesso.

O sistema salva apenas JSONs normalizados, jamais respostas brutas. Cada dia bem-sucedido é salvo no checkpoint antes de passar ao próximo; falhas individuais não apagam dias anteriores. O workflow versiona apenas os arquivos públicos alterados e aciona o deploy de Pages quando houver mudança.

Para simular uma competência sem token nem consultas:

```bash
BACKFILL_MONTH=2026-10 BACKFILL_DAYS=3 npm run backfill:plan
```

**Nota:** a atualização diária da CGU consulta a janela recente. A recuperação histórica atua sobre competências anteriores e não realiza qualquer comparação com o Tesouro Gerencial.

## Estrutura

- `src/`: adaptador CGU, normalização, privacidade, armazenamento incremental e validação
- `test/`: testes automatizados de coleta, esquema, idempotência e privacidade
- `data/`: somente dados públicos normalizados e minimizados; catálogo de CNPJ por competência
- `assets/`: interface da aplicação
- `.github/workflows/`: CI de validação e coleta isolada

## Desenvolvimento

1. Fundação, ingestão CGU e consulta documental (em desenvolvimento).
2. Vínculos NE–NS–pagamentos, fichas detalhadas e enriquecimento por favorecido e processo (primeira versão implementada).
3. Favorecidos, processos, itens, PNCP/Compras.gov.br e índices SIOP/SIDRA.
4. Séries históricas completas, relatórios, qualidade e exportações.

A vinculação de fontes só deve ser exibida como confirmada quando houver chave documental verificável. Valores em centavos inteiros; ausência de dados é `null`, nunca zero presumido.

> Projeto experimental, independente de publicação ou decisão oficial do IFC.


## Relações de pagamentos e itens de empenho

A API pública da CGU disponibiliza `/despesas/empenhos-impactados` para **fase 3 (pagamentos)**, incluindo `valorPago` e `valorRestoPago`; esses valores são somados por NE relacionada apenas quando a paginação e todos os registros são válidos. Nenhuma relação é presumida por proximidade de datas, valores ou favorecidos. Um pagamento pode impactar várias NEs, inclusive de exercícios anteriores.

A consulta `/despesas/itens-de-empenho` traz sequência, código, descrição, subelemento e valor atual. O sistema grava apenas campos mínimos sanitizados e suprime descrições com risco identificável de conter dados pessoais ou bancários. Isso não substitui a descrição da nota fiscal nem do contrato.

A rotina independente `Enriquecer pagamentos e itens CGU` executa lotes pequenos no GitHub Actions, em agenda e manualmente. Um documento já consultado não será consultado novamente enquanto não houver indicação de mudança em seu valor documental. As informações são agregadas **no mesmo JSON mensal**, sem duplicar os registros da CGU; itens são referenciados pela NE e vínculos de pagamento são marcados como consultados para permitir retomada.

```bash
npm run enrich:plan
# executa com CGU_API_KEY somente em ambiente autenticado:
npm run enrich:cgu
```

Os resultados devem ser interpretados como **relações documentais da CGU**, não conciliação contábil, situação de pagamento bancário ou medida de saldo. A interface informa quando itens ou vínculos ainda aguardam consulta e permite localizar documentos relacionados em outras competências já coletadas.

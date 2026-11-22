# Observatório de Despesas Públicas

Aplicação pública independente para consulta e rastreabilidade de documentos de despesa do IFC. **Escopo inicial:** UG 158459 (IFC Araquari); a UO 26422 corresponde ao IFC como um todo e não deve ser confundida com a UG.

## Situação

Projeto em implantação por etapas. Primeiro módulo: documentos de empenho, liquidação e pagamento do **Portal da Transparência/CGU**, com armazenamento mensal incremental, controle de cobertura, testes e interface estática. A primeira expansão inclui identificação segura de favorecidos, processos e classificação da despesa. A integração inicial de PNCP e Compras.gov.br inclui um catálogo contratual separado, com classificação entre IFC institucional e Campus Araquari; SIOP, SIDRA e fontes complementares serão incorporados progressivamente.

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
npm run enrich:plan       # simula vínculos de liquidações, pagamentos e itens de NE
npm run contracts:plan    # simula consulta PNCP/Compras sem requisicoes
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

O workflow `.github/workflows/backfill-cgu.yml` faz a recuperação em **lotes pequenos** (padrão três dias, máximo sete dias por execução). A seleção automática começa pelo **mês anterior em America/Sao_Paulo** e retrocede entre as competências incompletas; é possível escolher qualquer competência como `2026-10` usando **Actions → Recuperar histórico CGU → Run workflow**. Ele também executa lotes agendados diariamente.

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

A rotina independente `Enriquecer liquidações, pagamentos e itens CGU` executa lotes pequenos no GitHub Actions, em agenda e manualmente. Um documento já consultado não será consultado novamente enquanto não houver indicação de mudança em seu valor documental. As informações são agregadas **no mesmo JSON mensal**, sem duplicar os registros da CGU; itens são referenciados pela NE e vínculos de pagamento são marcados como consultados para permitir retomada.

```bash
npm run enrich:plan
# executa com CGU_API_KEY somente em ambiente autenticado:
npm run enrich:cgu
```

Os resultados devem ser interpretados como **relações documentais da CGU**, não conciliação contábil, situação de pagamento bancário ou medida de saldo. A interface informa quando itens ou vínculos ainda aguardam consulta e permite localizar documentos relacionados em outras competências já coletadas.


## Integração de contratações — PNCP e Compras.gov.br

O Observatório diferencia **UG 158459**, **CNPJ do Campus Araquari 10.635.424/0003-48** e **CNPJ da Reitoria 10.635.424/0001-86**. Muitas contratações do IFC podem ser publicadas centralmente. Um contrato identificado no CNPJ da Reitoria **não é automaticamente despesa de Araquari**.

O workflow `Coletar contratos PNCP e Compras.gov` consulta, sem autenticação, o PNCP por mês de publicação e CNPJ do órgão. Para Compras.gov, primeiro tenta obter o código oficial do órgão pelo cadastro da UASG 158459; somente com essa identificação consulta os contratos correspondentes, usando filtros de vigência. **Se a API retornar HTTP 404 ou outro erro, o sistema registra a fonte indisponível, nunca zero contratos.**

O arquivo `data/procurement/contracts.json` é um catálogo mínimo separado dos documentos CGU; não se salvam cópias de contratos em cada empenho. Ele inclui identificador oficial, processo, fornecedor identificado como PJ/CPF parcialmente mascarado, unidade, objeto sanitizado, valor global, vigência e cobertura por fonte/competência. Os detalhes públicos estão disponíveis no explorador de contratos. Não há download de respostas brutas nem novos Secrets.

A conciliação é **conservadora**:

- **Identificador confirmado:** documento CGU de empenho com código de NE coincidente com instrumento publicado da unidade Araquari.
- **Correspondência contextual:** processo administrativo **e CNPJ** do fornecedor iguais, porém sem identificação documental direta. Nunca considerada pagamento ou execução de contrato.
- **Sem correspondência:** não é evidência de inexistência da contratação; as bases têm coberturas e ciclos de atualização distintos.

Nunca se somam valores de PNCP e Compras.gov para obter um total único, pois um mesmo contrato pode constar em ambas as fontes. Tampouco se somam valores contratuais à execução documental da despesa.

Para executar manualmente: Actions → **Coletar contratos PNCP e Compras.gov** → Run workflow; opcionalmente informe `month` em `AAAA-MM`. A rotina agenda duas consultas semanais e chama o deploy do GitHub Pages somente quando o catálogo normalizado muda. Em caso de indisponibilidade, o último arquivo válido é preservado.

Documentação oficial: [PNCP API Consulta](https://pncp.gov.br/api/consulta/swagger-ui/index.html) e [Compras.gov dados abertos](https://dadosabertos.compras.gov.br/swagger-ui/index.html).

## Centralização institucional das contratações (revisão da classificação)

As contratações do IFC são publicadas centralmente pela Reitoria (**UASG 158125**), mesmo quando a execução é responsabilidade dos campi. Portanto, o CNPJ da Reitoria e o campo de unidade que publicou um contrato no PNCP **não identificam o campus beneficiário**. A UG financeira de Araquari é **158459** e o identificador SIPAC de origem de processos do campus é **23349**.

A classificação pública agora se baseia na seguinte hierarquia:

1. **Confirmação por NE:** nota de empenho vinculada ao contrato no PNCP contém UG 158459 e número completo. Também se aceita NE abreviada no PNCP **apenas quando confrontada** com NE da mesma UG, ano e número existente na CGU. Nunca se inventa código de gestão para completar números.
2. **Indício por NE:** o PNCP informa unidade 158459 e número abreviado da NE, sem documento CGU correspondente; não classificar como vínculo confirmado.
3. **Correspondência contextual:** mesmo número do processo e CNPJ do fornecedor entre contrato e documento CGU; não é prova de vínculo financeiro.
4. **Indício administrativo:** processo `23349.XXXXXX/AAAA-DV`, prefixo utilizado em Araquari, mas digitado manualmente e sujeito a erros.
5. **Sem atribuição:** não há evidência suficiente, embora o contrato ainda possa atender Araquari por centralização excepcional.

O filtro padrão do explorador de contratos exibe instrumentos com **indícios ou confirmação**; `Todos os contratos do IFC` revela todo o acervo publicado pela Reitoria, sem confundir publicação centralizada com execução financeira do campus.

O PNCP possui a consulta pública `GET /api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/empenhos`, que devolve `numeroEmpenho`. O workflow **Verificar empenhos PNCP vinculados aos contratos do IFC** consulta em pequenos lotes, preserva no mesmo JSON contratual somente números em que UG 158459 esteja explicitamente identificada, e marca conclusão ou indisponibilidade. Empenhos de outros campi não são replicados. A consulta pode não conter o campo necessário para identificar a UG; sua ausência **não é prova de que não existam empenhos**.

Para simular a próxima busca, execute `npm run pncp-ne:plan`. Nenhum novo token é necessário.

**Atenção:** a API PNCP também publica licitações, dispensas e inexigibilidades na coleção separada `/v1/contratacoes/publicacao`. O fato de uma contratação não possuir contrato registrado não significa que ela não exista. A coleta dessa coleção será um módulo próprio, usando os mesmos graus de evidência e abrangendo todas as modalidades publicadas, não apenas contratos.


## Licitações e contratações diretas publicadas pela Reitoria

Além dos contratos e empenhos, o Observatório possui um coletor próprio da coleção de **contratações publicadas** no PNCP (`/api/consulta/v1/contratacoes/publicacao`). A Reitoria utiliza a UASG **158125** como publicadora centralizada, portanto o catálogo não associa automaticamente a compra a Araquari.

A consulta varre os **14 códigos de modalidade** oficiais, incluindo pregão eletrônico e presencial, concorrência eletrônica e presencial, diálogo competitivo, concurso, dispensa de licitação, inexigibilidade, credenciamento, pré-qualificação, leilões e inaplicabilidade. O endpoint exige o código da modalidade; uma única requisição não cobre todas as modalidades.

- **Retenção mínima:** `data/procurement/notices.json` com ID PNCP, número da contratação, modalidade, processo, objeto sanitizado, valor estimado e homologado, situação, SRP e mês; sem respostas brutas nem duplicação de contratos da CGU.
- **Cobertura explícita:** cada mês/modalidade é identificado como completo, parcial ou indisponível. HTTP de falha não significa que não existam publicações.
- **Identificação subsidiária de Araquari:** `23349` indica origem provável. Uma contratação pode ser associada com maior confiança quando um contrato PNCP vinculado tiver NE confirmada da UG 158459. A ausência de processo `23349` **não exclui** contratações centralizadas excepcionais.
- **Explorador:** por padrão destaca publicações com evidência/indício de Araquari e oferece o filtro `Todas as publicações do IFC` para consulta integral do acervo da Reitoria.

A rotina `Coletar editais e contratacoes diretas PNCP - IFC` executa automaticamente duas vezes por semana e pode ser iniciada em Actions, com competência opcional `AAAA-MM`. Para simular, sem consultar APIs, use `npm run pncp-notices:plan`. A publicação é feita pelo mesmo workflow GitHub Pages por Actions, somente quando o catálogo muda.


## Vínculo oficial PNCP: contrato → contratação de origem

A API de **consulta individual de contrato** (`GET /api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}`) expõe `numeroControlePncpCompra` (grafia verificada em resposta real). Trata-se do **identificador oficial da contratação de origem**. A consulta resumida de contratos nem sempre o entrega; o serviço que lista contratos a partir de uma contratação retornou HTTP 400 nas amostras do IFC. Por isso o Observatório adota o caminho efetivamente validado, consultando detalhes de contratos existentes.

A rotina `Vincular contratos às licitações pelo ID oficial PNCP` executa pequenos lotes, prioriza possíveis contratos de Araquari e salva apenas `procurementId` no mesmo `contracts.json`, com `procurementLinkStatus` (`linked`, `not_reported`, `unavailable`) e `procurementLinkAt`. Erro remoto não remove referência já confirmada; contratos sem referência informada não são convertidos em relação inventada. É possível simular com `npm run pncp-links:plan`.

A interface permite navegar de contrato a licitação de origem e da licitação a seus contratos **por ID oficial PNCP**. Esse vínculo comprova a associação da publicação do contrato à contratação; **não comprova execução pela UG 158459**. Para essa conclusão continuam valendo as regras anteriores: NE da UG 158459 registrada oficialmente e conferida, seguida de indícios processuais `23349`. A busca por licitações do IFC permanece aberta a todos os campi, evitando atribuir indevidamente a Araquari os contratos centralizados pela Reitoria.

A relação pode apontar a uma contratação de outra competência ainda não coletada no catálogo de editais; nesse caso é exibido o link para o registro oficial, sem fabricar dados locais. Não existe novo arquivo redundante, token, coleta de pessoa física ou consulta ao Tesouro Gerencial.


## Recuperação histórica pontual das licitações vinculadas

Quando um contrato publicado hoje se refere a uma contratação de 2025 ou de outro mês de 2026, o Observatório recupera a licitação **diretamente pelo identificador PNCP informado no detalhe do contrato**: `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`. Isso evita varrer todos os meses e as 14 modalidades para descobrir uma contratação já conhecida.

O workflow `Recuperar licitações históricas vinculadas a contratos PNCP` compara `procurementId` dos contratos com os IDs já conhecidos de `notices.json`, consulta somente os faltantes e normaliza o resultado no **mesmo catálogo**. A consulta exige o retorno do mesmo ID esperado e suprime dados pessoais/objetos inseguros. Contratações antigas sem cobertura mensal integral entram com status `partial` para mês/modalidade; **uma consulta individual jamais é apresentada como cobertura completa**.

A rotina é semanal ou pode ser acionada manualmente; `npm run pncp-related:plan` permite conhecer a quantidade de IDs faltantes sem chamar a API. Contratos centralizados da Reitoria não passam a ser atribuídos a Araquari por causa desse vínculo; a comprovação por NE da UG 158459 continua independente.

**Confiabilidade dos workflows:** todas as rotinas que escrevem dados consultam o `main` mais recente no início do job (sem alterar branch de CI). Isso corrige o conflito observado quando duas coletas eram enfileiradas no mesmo commit: a segunda tentativa de push falhava por estar baseada em uma versão antiga.

**Ajuste da rota de consulta histórica (novembro de 2026):** a primeira tentativa com `/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}` não recuperou os registros amostrados. O adaptador passou a usar o endpoint público `/api/consulta/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`, documentado na API PNCP Consulta. Falhas são contabilizadas apenas por tipo (HTTP ou validação), sem dados pessoais ou respostas brutas nos logs.

**Limites de requisições do PNCP:** a recuperação histórica direta encontrou HTTP 429 em cinco consultas após os primeiros 13 resultados. Para evitar bloqueio e consultas repetidas, o workflow passou a espaçar as requisições em 5,5 segundos e executar backoff adicional de 15/30 segundos somente após HTTP 429 persistente. A indisponibilidade é contabilizada e o registro continua pendente; nunca é convertido em ausência de licitação. O lote padrão foi ajustado para até 30 IDs por execução, respeitando os limites da API.


## Contratos formais, empenhos substitutivos e documentos SIAFI

**Correção de tipologia:** a coleção `/contratos` do PNCP inclui `tipoContrato.nome = "Empenho"`, correspondente a instrumento substitutivo, não a termo de contrato. O Observatório agora lista na tabela **Contratos formais** somente instrumentos explicitamente reconhecidos como `Contrato (termo inicial)` ou equivalente estrito. Os registros PNCP de NEs continuam rastreáveis por ID de licitação, sem aparecer como contratos formais, sem somar valores novamente e sem reproduzir notas de outros campi na tabela de despesas da UG 158459.

Na fotografia de novembro/2026, dos 70 instrumentos publicados pelo IFC na coleção PNCP: 9 termos de contrato e 61 notas de empenho. Somente um termo formal desse grupo apresenta processo começando por `23349`; trata-se de um indício, não de NE confirmada. Essa fotografia de novembro **não é um inventário exaustivo de todos os contratos de Araquari em vigor**.

Os registros da CGU distinguem fase da despesa e espécie SIAFI: NE, NS, OB, DF e outras. A fase da CGU **não certifica** estorno, anulação, reforço, saldo, quitação ou a natureza completa do movimento. As regras de relacionamento N:M e critérios de cobertura são documentados em [Modelo conceitual das despesas](docs/MODELO-CONCEITUAL-DESPESAS.md).

A configuração autenticada já existente é a chave de **CGU** `CGU_API_KEY`, transmitida somente no GitHub Actions pelo cabeçalho `chave-api-dados`. Não há chaves no JavaScript do Pages. O PNCP tem API pública separada, sem necessidade dessa chave.


## Diagnóstico autenticado de documentos SIAFI pela CGU

A execução independente `Diagnosticar documentos e historicos SIAFI pela API CGU` utiliza o **repository secret já cadastrado `CGU_API_KEY`** apenas em GitHub Actions, enviando-o no cabeçalho `chave-api-dados` para consultar uma amostra de **NE, NS, OB e DF da UG 158459**. Verifica (quando disponível):

- `/despesas/documentos/{codigo}` — **nomes e tipos dos campos** do documento detalhado;
- `/despesas/documentos-relacionados` — somente quantidade e tipos dos campos dos documentos relacionados;
- `/despesas/empenhos-impactados` nas fases 2 e 3 — somente contagem de NEs distintas impactadas e indicadores de valores negativos, **somente primeira página**;
- `/despesas/itens-de-empenho/historico` — somente nomes dos campos e contagens por categorias de operação (emissão, reforço, anulação, cancelamento, estorno e não identificado).

O diagnóstico não cria arquivos, não altera `data/`, não publica novos documentos e **nunca expõe token, identificador completo, valor, CPF, favorecido ou resposta bruta nos logs**. Dados pessoais da API são tratados exclusivamente em memória, sem serialização. O objetivo é validar o esquema que embasará futuro controle auditável de movimentos e anulações; ausência de campo ou HTTP de falha é **incerteza**, nunca movimento inexistente.

As etapas completas da despesa, hipóteses de instrumento contratual substitutivo e relações N:M estão documentadas em `docs/MODELO-CONCEITUAL-DESPESAS.md`. A fonte autenticada em uso é a **CGU**, não AGU.

## Auditoria de qualidade e cobertura (UG 158459)

O painel apresenta separadamente **cobertura documental diária** (NE, NS e pagamento nas
três fases, por data encerrada em America/Sao_Paulo), **enriquecimento CGU** (quantas NS,
pagamentos e NE tiveram suas consultas complementares concluídas), e **alertas de revisão**.
O estado de cobertura completa **não** afirma que os vínculos tenham sido todos
enriquecidos. A ausência de registros publicados não equivale a despesa zero.

A auditoria em `assets/quality.js`, utilizada pelo painel e por `npm run check:data`,
contabiliza múltiplas NEs por documento, valores negativos (que podem representar anulação),
empenhos de exercícios anteriores e diferenças entre a soma dos vínculos consultados e
o valor da NS. Divergências de soma são **sinalizadas para revisão**, sem substituir valores
da fonte ou declarar ilegalidade. A auditoria não calcula saldo de contrato, restos a pagar
ou reconciliação contábil; tampouco combina valores de empenho, liquidação e pagamento
num único total. Duplicidades e vínculos estruturalmente inválidos bloqueiam a validação.

### Ampliação histórica e priorização

A rotina de recuperação histórica agora seleciona automaticamente a competência mais
recente com dias encerrados pendentes, depois retrocede até `BACKFILL_EARLIEST_MONTH`
(padrão inicial `2026-01`). Executa **três dias por lote, diariamente**, preservando
checkpoints, as três fases e limites de paginação. Não presume que o período anterior ao
limite configurado tenha sido coletado. Para períodos anteriores a 2026, ajuste o limite
na execução manual; a cobertura de todo o histórico disponível deve ser feita de forma
progressiva e verificada por mês.

A rotina de enriquecimento permanece em dois lotes diários: às 12h17 UTC prioriza
o mês mais antigo com pendências; às 22h17 UTC prioriza o mais recente. Isso evita
que novas despesas impeçam o avanço dos períodos anteriores. A execução manual
permite escolher competência e limites, sem publicar credenciais.

Após o deploy, `npm run verify:pages` compara o HTML, os módulos públicos,
o manifesto e até oito JSONs mensais recentemente atualizados com o que o endereço
informado por `SITE_BASE` realmente entrega. O workflow aguarda a atualização do
CDN com tentativas limitadas e informa falha se não conseguir comprovar a publicação.
Uma falha nessa verificação **não** implica que o deploy anterior tenha sido revertido.

```bash
npm run check:syntax
npm test
npm run check:data
npm run build:site
# no GitHub Actions, SITE_BASE vem da URL retornada pelo deploy:
SITE_BASE=https://guimig.github.io/observatorio-despesas/ npm run verify:pages
```


## Trajetória documental por nota de empenho

A seção **Trajetória por nota de empenho** reúne, a partir de todos os JSONs mensais publicados, as NEs e os vínculos CGU de liquidação (fase 2) e pagamento (fase 3). A NE é o eixo de consulta: uma mesma NE pode reunir várias NS e vários documentos da fase de pagamento, inclusive em exercícios posteriores ou anteriores. A ficha também apresenta os itens de empenho quando a consulta correspondente foi concluída.

A interface distingue:
- documento NE localizado no acervo e vínculo que aponta para NE ainda não coletada;
- documentos de liquidação e documentos de pagamento, em listas independentes;
- valor documental original de cada documento e valor do vínculo retornado pela CGU;
- consulta concluída, pendente e documento relacionado não localizado.

**Limite essencial:** a relação CGU disponível vincula NS e documentos de pagamento às NEs impactadas. Ela não comprova, por si só, que uma OB/DF específica quitou uma NS específica. Portanto a ficha não cria arestas diretas NS→OB/DF, não deduz quitação integral e não calcula saldo contábil. Valores negativos são mantidos como publicados, sem classificá-los automaticamente como anulação. Os somatórios exibidos são apenas somas dos vínculos de cada fase, não total líquido da despesa.

## Replanejamento v0.2 — governança e cobertura real

O desenvolvimento agora segue o [Plano Diretor v0.2](docs/PLANO-DIRETOR.md) e as [instruções para agentes e contribuidores](AGENTS.md). Implementar código, executar um workflow e homologar indicadores contábeis são estágios **distintos**.

`npm run audit:baseline` apresenta agregados de documentos, enriquecimentos e cobertura histórica; `node src/diagnose-coverage.mjs --audit-md` produz um resumo Markdown (sem números de documentos individuais) nos checks de CI e nas recuperações históricas CGU. A auditoria considera meses ainda sem arquivos, dias encerrados ausentes e dias com alguma fase incompleta, usando `2025-01` como limite inicial. Indicadores não permitem concluir que o acervo de pagamentos está conciliado ou que ausência de documento equivale a gasto zero.

A rotina de backfill está programada para dois lotes diários, com três dias elegíveis por lote e possibilidade de execução manual entre um e sete dias; as consultas dependem do Secret `CGU_API_KEY`, dos limites da API e da validação dos checkpoints. O aumento inicial visa recuperar histórico gradualmente sem elevar o tamanho individual das requisições. Monitorar conclusões/erros de Actions antes de ampliar mais.

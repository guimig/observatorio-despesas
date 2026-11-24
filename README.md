# Observatório de Despesas Públicas

Aplicação pública independente para consulta e rastreabilidade de documentos de despesa do IFC. **Escopo inicial:** UG 158459 (IFC Araquari); a UO 26422 corresponde ao IFC como um todo e não deve ser confundida com a UG.

## Situação

Projeto em implantação por etapas. Primeiro módulo: documentos de empenho, liquidação e pagamento do **Portal da Transparência/CGU**, com armazenamento mensal incremental, controle de cobertura, testes e interface estática. A primeira expansão inclui identificação segura de favorecidos, processos e classificação da despesa. A integração inicial de PNCP e Compras.gov.br inclui um catálogo contratual separado, com classificação entre IFC institucional e Campus Araquari; SIOP, SIDRA e fontes complementares serão incorporados progressivamente.

O projeto não consulta, altera nem substitui os relatórios do Tesouro Gerencial e não depende do EmailBackupHub. A integração com o Tesouro Gerencial está suspensa por decisão de 23/11/2026: a prioridade passou a ser [ampliar a pesquisa e validação de APIs oficiais dinâmicas](docs/FONTES-API-PRIORIDADES.md), preservando a CGU como fonte principal. Nenhum dado histórico é considerado completo antes da coleta e da validação correspondentes.

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
npm run audit:cgu-interannual # audita chaves CGU entre exercícios sem consultar APIs
npm run contracts:plan    # simula consulta PNCP/Compras sem requisicoes
npm run pncp-delta:plan   # planeja atualizacoes PNCP sem chamar fonte externa
npm run pncp-recovery:plan # mostra fila de publicacoes PNCP sem consultar API
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

A recuperação histórica mantém **um lote diário com três dias elegíveis** e permite execução manual entre um e sete dias. Após três falhas consecutivas observadas em 22/11/2026, a ampliação da frequência foi bloqueada até diagnóstico. A próxima execução registra categorias técnicas de falha sem payloads, chaves ou IDs; os checkpoints íntegros são preservados.

## Recuperação histórica resiliente por fase

O fluxo de backfill utiliza os três registros `coverage[date, phase]` separadamente: uma falha na fase de liquidação não bloqueia a gravação de fases de empenho e pagamento válidas, e uma próxima tentativa recupera somente fases incompletas. Lotes agendados distribuem dias pendentes com rotação, mantendo limite de três dias; execução manual segue sequencial para facilitar diagnóstico específico. O relatório operacional exibe dia, fase, contagem e categoria sanitizada de falha. Isso **não significa** cobertura financeira completa nem comprova ausência de despesas em dias sem registros.

## Documentos canônicos e sobreposição entre fases CGU

Alguns documentos SIAFI são devolvidos em mais de um filtro de fase da CGU, sem que isso por si só comprove uma segunda operação financeira. O formato mensal mantém cada documento uma única vez em `documents` e registra aparições adicionais em `phaseObservations` (identificador, data, filtro consultado e comparação não monetária de valores). A cobertura de cada fase continua usando a quantidade de **ocorrências na consulta**, sem multiplicar identidades. A interface sinaliza sobreposições e não apresenta como definitivos os totais de fases atingidas. O campo é opcional, preservando os JSONs existentes e sem exigir banco externo.

## Recuperação incremental de descrições históricas

Desde a ampliação dos campos narrativos, textos anteriormente omitidos por limite de 260 caracteres podem ser recuperados em reconsultas oficiais. O workflow `.github/workflows/recuperar-descricoes.yml` usa lotes pequenos: até cinco publicações PNCP de licitação, cinco instrumentos PNCP e dois dias com NEs históricas sem descrição por execução; não cria base adicional.

O planejamento prioriza registros sem texto seguro e registra somente a data da última consulta (`objectCheckedAt` ou `descriptionCheckedAt`), com rechecagem após 30 dias se a fonte continuar sem descrição publicável. Reconsultas válidas preservam o texto já confirmado e não publicam respostas brutas, nomes de pessoas físicas nem tokens. É possível simular com `npm run narratives:plan` e executar `npm run collect:narratives` (a parte CGU requer `CGU_API_KEY`). Falha ou conteúdo bloqueado por privacidade não significa que o documento original esteja sem objeto.

As descrições são exibidas apenas na ficha detalhada; os campos de pesquisa podem continuar usando esses textos sem sobrecarregar a tabela. O formulário modal inicia sempre no topo, inclusive ao alternar documentos sem fechá-lo.

## Reconsulta incremental de atualizações do PNCP

A coleção de licitações e contratos formais/instrumentos PNCP agora contém metadados opcionais `sourceUpdatedAt` (data informada pela fonte), `recheckedAt` (última consulta completa), `lastChangedAt` (data em que foi observada diferença material) e `revisionCount` (quantidade de diferenças observadas pelo coletor; **não** quantidade jurídica de aditivos). `npm run pncp-revisions:plan` apresenta apenas totais planejados; `npm run recheck:pncp` reconsulta até quatro licitações e quatro instrumentos por vez. A rotina agendada tem cadência de três execuções semanais, sem banco adicional ou resposta bruta. Registros antigos são rechecados, mesmo que a competência de publicação já esteja encerrada.

A reconsulta usa exclusivamente ID oficial PNCP; não identifica compras de Araquari apenas pela Reitoria nem converte valor contratual em execução financeira. Falha da API ou campo omitido não exclui registro antigo. O frontend exibe datas de revisão na ficha detalhada. Limites e metodologia: `docs/PLANO-DIRETOR.md` e [issue #89](https://github.com/guimig/observatorio-despesas/issues/89).

## Evolução da extração de textos e itens SIAFI — 22/11/2026

Caso de homologação: impressão completa da **NE 158459264222026NE000288**, emissão em 18/11/2026, versão 002 alterada em 19/11/2026, total R$ 794,85. O SIAFI informa subelemento 11 (Material Químico) e quatro linhas: seq. 001/compra 00006 (acetato de etila, 10 × R$ 30,00, R$ 300,00), 002/00008 (acetona, 5 × R$ 30,00, R$ 150,00), 003/00142 (éter dietílico, 2 × R$ 100,00, R$ 200,00), 004/00157 (hexano, 5 × R$ 28,97, R$ 144,85). A captura antiga omitia descrições extensas (limite 260 caracteres), misturava o número de item da compra na descrição, e não coletava quantidade/preço unitário/histórico.

O modelo mensal, ainda compatível com schema 1, admite `itemsDetailVersion:2` no documento NE, `purchaseItem` no item (sequencial da contratação extraído **somente quando o texto oficial declara "Item compra: 00000 -"**), `description` de até 5.000 caracteres após sanitização e `historyChecked:true` acompanhado por `movements[]`. Cada movimento contém `date` da operação, `operation` oficial, `type` apenas classificatório, `quantity` e `unitPrice` como strings decimais de precisão preservada e `cents` para o valor da operação; nada é agregado como saldo histórico. `itemsByDocument` continua agrupável por código/descrição de subelemento, permitindo diferentes subelementos na mesma NE.

O endpoint `/despesas/itens-de-empenho/historico` é consultado separadamente para cada sequencial, por lotes limitados e páginas verificadas, com checkpoint idempotente por item. Retorno incompleto ou não validado **não marca consulta concluída**. NEs já enriquecidas na versão antiga são reconsultadas, sem descarte dos dados anteriores até a nova coleta integral; históricos anteriores são preservados quando o item mantém o mesmo valor atual. Exemplo de versão alterada da impressão SIAFI não comprova reforço ou anulação: a classificação de `reinforcement` / `annulment` só se apoia no campo `operacao` do histórico CGU e não infere saldo contábil.

O campo narrativo sanitizado `description`, antes restrito a NE, passa a ser aceito para todas as espécies retornadas nos filtros CGU, incluindo NS/OB/DF, quando existir; textos com indício de dados sensíveis são omitidos e não registrados. A rotina histórica preexistente de reconsulta de descrição das NEs deve ser estendida separadamente para NS/OB/DF quando houver datas comprovadas, respeitando limites da API e as consultas integrais já efetuadas. A ficha exibe descrições somente no detalhe e abre com rolagem no início; os movimentos de cada item são recolhíveis.

**Limite de verificação:** o PDF da NE serve como referência comparativa, não como origem para alterar o JSON automático. A confirmação dos quatro códigos de compra, quatro descrições, quantidades e unidades no acervo depende da recuperação autenticada dos endpoints CGU e da cobertura de histórico; divergência permanece explicitada, nunca corrigida manualmente com números de anexo.

## Conferência documental dos movimentos de itens (22/11/2026)

A nova ficha distingue **conferência documental** de **conciliação contábil**. A função pura `assets/siafi-movement-audit.js` analisa somente movimentos coletados, verificando a cobertura (itens com `historyChecked`), a soma dos **valores atuais informados** dos itens diante do valor documental da NE e, quando todos os históricos contêm uma única `INCLUSAO`, a coincidência da data de inclusão e valor por sequencial. A implementação não altera os valores da fonte e não produz um saldo líquido.

Estados possíveis: `unavailable` (itens não consultados), `partial` (pelo menos um histórico ainda pendente), `no_movement_evidence` (consulta concluída sem movimento retornado), `original_only_consistent` (coincidência dos dados documentais originais), `additional_operations` (reforço, anulação ou outra operação identificada), `requires_review` (divergência de dados ou insuficiência para atestar inclusão única) e `no_items`. A expressão *consistente* não é sinônimo de saldo contábil conciliado e não comprova inexistência de pagamentos ou restos a pagar.

As datas e valores de operações adicionais permanecem como evidências individuais; não se adota sinal positivo/negativo de reforço/anulação sem validar a semântica oficial, tampouco se soma pagamento ou ARP PNCP como despesa da NE. A [issue #29](https://github.com/guimig/observatorio-despesas/issues/29) continua aberta para conciliação contábil, restos a pagar, versionamento/retificação dos movimentos e auditoria de operações reais complexas.

## Homologação aritmética de reforços e anulações (amostras reais CGU — 22/11/2026)

O acervo publicado `data/months/2026-11.json` contém quatro NEs cujos históricos de itens registram reforços e/ou anulações, com conferência aritmética do valor atual. Uma função pura em `assets/siafi-movement-reconciliation.js` reconstrói **valor atual dos itens a partir de movimentos oficiais**, usando `INCLUSAO + REFORCO - ANULACAO` somente quando todas as seguintes condições estão comprovadas: todos os sequenciais com histórico completo, exatamente uma inclusão original por item, campos de data e valor válidos, operações com semântica reconhecida, valores monetários positivos informados pela fonte e sequência que não resulta em total negativo. Operações de cancelamento, estorno, outras ou tipo desconhecido não têm sinal presumido: a reconstrução fica indisponível. O total reconstruído deve coincidir com o `valorAtual` dos itens; a soma destes deve coincidir com o valor documental quando disponível. Valores divergentes permanecem **divergentes**, não são ajustados.

Amostras da UG 158459, em **reais**, já registradas na CGU e inseridas como teste de regressão (nomes de fornecedores e processos não são utilizados):

| NE 2026 | Primeira inclusão identificada | Base da inclusão | Reforços | Anulações | Valor reconstruído | Valor atual CGU |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 000005 | 16/01/2026 | R$ 200.000,00 | R$ 789.998,93 | R$ 395.088,41 | R$ 594.910,52 | R$ 594.910,52 |
| 000216 | 10/07/2026 | R$ 28.000,00 | R$ 1.700,00 | R$ 0,00 | R$ 29.700,00 | R$ 29.700,00 |
| 000258 | 07/10/2026 | R$ 36.125,00 | R$ 37.175,00 | R$ 0,00 | R$ 73.300,00 | R$ 73.300,00 |
| 000281 | 11/11/2026 | R$ 400,00 | R$ 2.500,00 | R$ 0,00 | R$ 2.900,00 | R$ 2.900,00 |

**Atenção à cronologia:** o campo `date` do acervo é a data retornada no filtro de listagem CGU (nos exemplos, datas de novembro), e **não é prova independente de emissão original da NE**. A primeira inclusão foi obtida do recurso de histórico dos itens, e é identificada como *primeira inclusão no histórico consultado*, não como a emissão documental formalmente comprovada; a conferência da capa/versão SIAFI continua pendente.

**Limites:** os montantes acima são reconstrução documental de `valorAtual` de itens, não saldo de dotação, saldo de empenho a liquidar, saldo a pagar, valor pago, restos a pagar ou saldo financeiro/contábil. Não deve haver soma direta com importâncias de PNCP, liquidações ou pagamentos. Falhas de cobertura ou divergência bloqueiam a reconstrução. O histórico do Git conserva versões de JSON, sem respostas brutas adicionais; a interface mostra esses valores apenas na ficha detalhada de empenho, junto ao alerta de limitação. A issue #29 permanece aberta para conciliação dos saldos e eventos de restos a pagar.

## Etapa incremental: reconsulta periódica do histórico de itens e cancelamento de RP (22/11/2026)

Históricos dos itens já consultados **não são registros imutáveis**: novas operações de reforço, anulação ou cancelamento podem ocorrer depois da primeira leitura. O enriquecimento da CGU agora suporta `historyCheckedAt` em cada item, com reconsulta quando o checkpoint estiver ausente (legado) ou tiver pelo menos 30 dias. Em cada execução, há lote independente de, no máximo, dois históricos previamente consultados; os históricos ainda pendentes continuam com seu próprio limite. A consulta novamente bem-sucedida atualiza a data; falha, paginação incompleta, resposta vazia que apagaria eventos existentes ou histórico que omita um evento anterior **não substitui** o conteúdo anterior e não atualiza o checkpoint. O Git guarda as versões efetivamente publicadas, sem persistir retorno bruto.

O cancelamento de item (como operação CGU `CANCELAMENTO`) é distinguido da `ANULACAO`, porque no Manual SIAFI 021213 o cancelamento de item está relacionado ao regime de restos a pagar. A reconstrução do **valor atual do item** pode considerar cancelamento como redução somente quando a fonte retornou tipo, data e valor verificáveis, o ano da NE é conhecido e a operação ocorre em **exercício posterior**; o resultado final precisa coincidir com o valor atual declarado na CGU. Caso contrário, a operação permanece visível, mas não gera reconstrução numérica. Estornos e operações de semântica não confirmada continuam bloqueados. Não existe amostra real de cancelamento homologada no acervo publicado até esta etapa: os testes desse cenário são sintéticos.

A reconsulta de `/documentos/{codigo}` para verificar a data formal de emissão e a versão do documento permanece pendente de confirmar no payload oficial um campo independente do `date` da listagem. Essa data **não** será fabricada a partir da data de inclusão do item. Mesmo quando uma reconstituição de valor de item é possível, ela **não representa** valores inscritos/cancelados/pagos de restos a pagar, saldo a liquidar, saldo a pagar ou conciliação contábil SIAFI. O próximo marco exige amostras reais de RP e fonte oficial apropriada antes de disponibilizar indicadores financeiros.

A sondagem autenticada `src/inspect-cgu-siafi.mjs` também foi ampliada para comparar **apenas booleanamente** o campo `data` de `/documentos/{codigo}` com a data da listagem CGU e a primeira inclusão dos itens. A sondagem não imprime nem persiste datas individuais, IDs ou payload. Ainda não se confunde automaticamente o campo de data do detalhe com emissão formal SIAFI: após analisar a comparação e a documentação, o modelo poderá distinguir data oficial do documento, data da publicação e data dos movimentos.

### Atualização incremental PNCP por data global

O workflow [`atualizar-contratos-pncp.yml`](.github/workflows/atualizar-contratos-pncp.yml) consulta diariamente os registros de contratos/empenhos publicados pela Reitoria ou Campus e **atualizados** na janela posterior à última consulta integral. Usa o mesmo `data/procurement/contracts.json`, com `pncpDelta` mínimo para checkpoint. Só atualiza **instrumentos com ID PNCP já cadastrado**; os novos IDs vão para a fila de recuperação mensal. Uma falha ou paginação excedida impede alteração de dados ou checkpoint. A integração é documental: **não** transforma PNCP em saldo financeiro ou RAP. Veja [critérios e cobertura](docs/FONTES-API-PRIORIDADES.md).

A detecção de IDs PNCP novos em uma janela de atualização agora conserva uma fila pequena de publicações pendentes (`pncpDelta.pendingPublications`) no catálogo existente. Uma competência de publicação é reconsultada por execução, com paginação integral e identificação exata; **só sai da fila se todos os IDs pendentes daquele mês forem confirmados**. HTTP 404, timeout, resposta parcial ou arquivo mensal sem o ID mantêm a pendência e as informações anteriormente publicadas. Essa recuperação nunca cria pagamento, liquidação ou saldo de restos a pagar.

### Recuperação dirigida de notas de empenho antigas pela CGU

A auditoria documental interanual pode identificar NEs da UG 158459 de exercícios anteriores ligadas a documentos NS, OB e DF de anos posteriores, mas **ainda sem origem presente no acervo mensal**. O workflow [`recuperar-origens-cgu.yml`](.github/workflows/recuperar-origens-cgu.yml) consulta a API oficial CGU diretamente **pelo código SIAFI integral**, em lotes de até três NEs por dia (máximo manual de cinco). A consulta usa o Secret `CGU_API_KEY` no runner; não envia credenciais ao navegador.

**Importante:** uma NE recuperada por código não comprova que os outros documentos daquele dia tenham sido consultados. Seu mês é criado com cobertura parcial `reason: "consulta_individual"` e `complete:false`. Somente a coleta diária integral pode marcar o dia completo, e uma resposta parcial posterior não pode apagar a NE recuperada. A data de emissão é extraída exclusivamente do campo oficial `data` do detalhe CGU, validada contra código, UG, fase e ano da NE; datas de reforços, anulações ou outros eventos não substituem a emissão.

Não se trata de cálculo de inscrição, cancelamento, pagamento ou saldo de restos a pagar. Nenhuma varredura anual adicional, snapshot bruto ou banco de dados foi criado. Os IDs e conteúdos não aparecem em logs. O agendamento diário distribui as consultas entre NEs ainda ausentes e pode ser chamado manualmente por GitHub Actions. Para conferir **apenas contagens** antes de consultar a API, use `npm run recovery:cgu-plan`.

A recuperação individual CGU também permite filtrar por exercício, sem consultar anos indiscriminadamente (`CGU_ORIGINAL_YEAR=2025 npm run recover:cgu-originals`). A comparação segura dos campos de data para uma NE histórica ainda bloqueada pode ser iniciada pelo GitHub Actions usando `npm run diagnose:cgu-original-date`; o diagnóstico imprime apenas categorias relativas ao ano da NE e não incorpora o documento. É um teste de semântica da fonte, não comprovação de RAP.

### Cronologia de emissão de NE histórica com divergência CGU

Para a única NE de 2024 cujo detalhe CGU retornou data de exercício posterior, existe um diagnóstico **somente de leitura** (`npm run diagnose:cgu-chronology-2024`, executado apenas no GitHub Actions com Secret). Ele compara datas de operações `original` em uma amostra limitada de itens com a listagem oficial da UG filtrada por `dataEmissao`. Mesmo uma correspondência por código SIAFI não altera automaticamente a nota: a origem segue pendente até homologação da data conflitante. Os logs só apresentam contagens e categorias, não datas, nomes, valores, códigos ou respostas brutas.

### Verificação segura de autenticação da CGU

O workflow `diagnosticar-cronologia-ne-2024.yml` executa um preflight autenticado em três rotas oficiais, usando uma NE controle já confirmada no catálogo, **antes** da única sondagem de emissão. O Secret deve ser interpolado exatamente por `CGU_API_KEY: ${{ secrets.CGU_API_KEY }}`, sem barra invertida literal antes do cifrão. Os testes automatizados verificam essa configuração para evitar regressões. Respostas 401/403 interrompem a investigação sem repetição contínua e não são interpretadas como ausência de documentos. O comando `npm run check:cgu-access` precisa de uma chave configurada no ambiente seguro; nunca inserir o valor diretamente em comandos, repositório ou logs.

### Verificação da NE 2024 por exercício de emissão (CGU)

O diagnóstico `npm run diagnose:cgu-2024-beneficiary-year`, executado apenas no workflow `diagnosticar-exercicio-ne-2024.yml` com o Secret CGU, utiliza o endpoint oficial `despesas/documentos-por-favorecido` com filtros `ano=2024`, `fase=1`, `ug=158459` e CNPJ público identificado por consulta individual. Não consulta CPF e não guarda respostas brutas. A busca termina após no máximo quatro páginas; resposta truncada ou vazia **não** comprova ausência no SIAFI. Um documento encontrado confirma apenas a correspondência na seleção anual da API — não a data exata de emissão, que continua exigindo fonte verificável.

### Confronto do exercício posterior indicado pela CGU

Após a busca de 2024 sem correspondência, o workflow `diagnosticar-exercicio-ne-2024.yml` passa a executar `npm run diagnose:cgu-2024-beneficiary-year -- --detail-year`, apenas por push do código ou disparo manual. Consulta exclusivamente o ano posterior válido observado no detalhe CGU, por CNPJ PJ e identidade exata; não repete a consulta anual anterior. Não guarda dados nem atribui emissão, mesmo se houver correspondência. A hipótese serve para investigar o índice anual da fonte; a pendência histórica e o bloqueio de saldos RAP permanecem até evidência adequada. Veja [resultados e limites](docs/FONTES-API-PRIORIDADES.md).

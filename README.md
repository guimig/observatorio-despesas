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
npm run enrich:plan       # simula itens e vínculos de pagamentos pendentes
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

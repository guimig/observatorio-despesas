# Recuperação incremental de NEs referenciadas

A varredura usa exclusivamente os arquivos mensais públicos já validados para identificar os **exercícios** das NEs mencionadas em vínculos de liquidação/pagamento cujo documento original ainda não foi coletado.

Como o identificador da NE informa o exercício, mas não a data de emissão, a recuperação consulta **todos os dias elegíveis**, por pequenos lotes, e não presume mês ou data da NE.

## Política

- O fluxo diário alterna, conforme o dia do mês em Brasília, entre a cobertura recente e a recuperação dos exercícios referenciados. Em dias ímpares, prioriza os anos com NEs ausentes; em dias pares, prioriza o mês anterior e as competências seguintes na varredura regressiva.
- Para cada exercício referenciado, começa pelo último mês elegível ainda incompleto e retrocede. Isso **não garante** que a NE será encontrada rapidamente: a cobertura precisa avançar por todo o exercício.
- O limite padrão inferior passa a ser 2025-01; a configuração manual pode restringi-lo.
- O checkpoint continua sendo o JSON mensal, sem banco de dados novo, arquivos de resposta bruta ou segredos.
- Cada lote usa os limites atuais de dias e paginação, com validação antes de publicar.
- A ausência da NE após um lote não comprova inexistência. A ficha permanece marcada como incompleta até localizar o documento ou obter evidência de cobertura integral.
- A recuperação de restos a pagar, inscrição e cancelamento permanece **pendente de fonte oficial específica**; não se infere RAP apenas pelo exercício da NE.

## Acompanhamento

Verifique a execução do workflow `backfill-cgu.yml`, o `data/manifest.json` e os campos `coverage` dos JSONs mensais. A contagem de NEs referenciadas sem documento deve ser recalculada após cada lote. O número pode aumentar temporariamente quando novas relações são descobertas.

## Recuperação por fase e rotação de dias (novembro de 2026)

O backfill da CGU agora separa as três fases para cada data. Um erro ao consultar a fase 2 não apaga nem impede a persistência de fases 1 e 3 válidas; o checkpoint mensal registra a cobertura de cada fase independentemente. Na próxima execução, só fases sem resultado completo e válido serão consultadas, exceto quando a rechecagem manual for expressamente solicitada.

Em execuções **agendadas**, os dias ainda pendentes são selecionados com rotação determinística limitada ao mesmo lote de três dias. Assim, uma data com erro repetido não bloqueia todas as outras datas. Datas problemáticas permanecem pendentes e voltam à fila; não são marcadas como completas nem excluídas. Execuções manuais mantêm seleção linear e parâmetro inicial informado pelo operador.

Os logs registram dia, **fase**, categoria segura de erro e quantidade de documentos consultados, nunca identificadores, resposta bruta, CPF, token ou URL individual de documento. Uma resposta vazia, com paginação validada, pode representar consulta documental completa sem registros. Resultado de coleta parcial nunca equivale a ausência de despesa ou total mensal definitivo.

**Critério de estabilidade antes de aumentar frequência:** acompanhar amostras reais, especialmente 08/12/2025 e 10/12/2025, verificar falhas por fase e reprocessar até cobertura completa. Manter um lote diário até três execuções sucessivas com evolução demonstrável e sem falha não diagnosticada. O controle de cobertura, e não a conclusão verde do workflow, determina se uma competência foi integralmente recuperada.

## Colisões de identificador SIAFI entre datas ou fases (22/11/2026)

A recuperação real encontrou rejeição por **documento público inválido ou duplicado** ao tentar gravar a fase 3 em 08/12/2025 (run 45057655056). Como o normalizador CGU já valida o formato SIAFI e a data da consulta, a duplicidade no acervo mensal é uma hipótese fortemente sustentada pela validação no armazenamento. Não se atribui automaticamente culpa à API nem se escolhe qual registro prevalece.

Antes de cada gravação, o coletor compara os documentos da fase com os identificadores já existentes naquela competência. Se o mesmo ID estiver associado a **outra data** ou **outra fase**, a fase inteira é rejeitada sem alterar o checkpoint. O log informa só data da consulta, fase, categoria do conflito e **quantidade de IDs conflitantes**, sem publicar os próprios identificadores. A coleta continua nas demais fases/datas. A fase rejeitada permanece sem cobertura válida e será reconsultada no futuro; o sistema não elimina documentos, não infere valores zero e não marca sucesso indevido.

A solução final da colisão ainda exige estudar o retorno real, a data e a espécie do documento e a semântica de fase na CGU/SIAFI. Não resolver por descarte silencioso, escolha da data mais recente ou redistribuição de valores sem evidência oficial. A issue #88 permanece aberta.

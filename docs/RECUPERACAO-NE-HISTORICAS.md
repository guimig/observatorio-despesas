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

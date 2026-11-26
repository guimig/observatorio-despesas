# Acesso institucional — API Dados SIAFI (STA)

Verificação em 26/11/2026. O [portal oficial](https://sta.api.gov.br/) identifica a equipe SEGES-DELOG-CGCON-COCTR do MGI como mantenedora. A [documentação OpenAPI](https://sta.api.gov.br/api/documentation) declara POST /api/login para JWT, POST /api/logout e consultas de empenhos/RP/OB autenticadas. Os esquemas documentados incluem fonte, ptres, picodigo, pidescricao, ug_orcamentaria_ptres, natureza e itens. Nenhuma credencial ou política pública de credenciamento para esta aplicação foi confirmada. Não confundir o serviço REST com a autorização de acesso aos arquivos STA do Tesouro ou com o Integra SIAFI do Serpro.

## Encaminhamento institucional sugerido

Solicitar à área responsável pelo Contratos.gov.br/STA do MGI, por intermédio do setor institucional competente do IFC, esclarecimento sobre:
- elegibilidade de uma autarquia federal e possibilidade de conta técnica de leitura para a UG 158459, sem credencial pessoal;
- escopo, termos de uso e possibilidade de divulgar **somente** classificações e campos já considerados públicos em portal institucional;
- disponibilidade de empenhos desde 2024, inclusive sem contrato formal, significado de fonte, PI, PTRES, UGR e RP, datas e cobertura de alterações;
- limite de requisições, validade/renovação de JWT, forma segura de provisionamento e eventual ambiente de homologação.

Não foi enviado pedido em nome do IFC. Não usar credenciais SIAFI pessoais, CGU_API_KEY, login de Compras.gov.br ou segredo compartilhado sem autorização expressa. Após confirmação oficial, usar secret específico para conta técnica (nunca navegador, logs ou dados versionados), teste limitado e somente leitura, validar identidade SIAFI integral e permissão de publicação antes de persistir informações. Sem acesso autorizado, manter a CGU como fonte principal e a sondagem estrutural pública existente.

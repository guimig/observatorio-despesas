# Controle operacional de atualidade

O Git guarda dados financeiros/documentais canônicos; o cache do Actions guarda somente datas de consultas, por identificador público ou hash do registro. Nunca guardar credenciais, respostas brutas ou dados pessoais. A data canônica indica a última consulta registrada com alteração; não equivale necessariamente à última reconsulta bem-sucedida.

- Cache descartável: ausência, corrupção ou expiração implica retorno aos checkpoints canônicos e nova consulta oficial, sem excluir dados.
- Um arquivo por coletor, até 1 MiB, 10.000 entradas e 90 dias de retenção lógica. As versões físicas antigas do cache seguem a expiração do GitHub. A cada execução, restaurar o último cache da família e salvar uma nova chave somente se o conteúdo mudou. Acesso regular mantém o cache recente; ausência de acesso por mais de sete dias pode levar à expiração. Não ampliar a quota padrão.
- Só atualizar a data de sucesso depois de consulta completa e persistência validada. Falha não equivale a ausência. Hash do conteúdo invalida a data operacional quando o registro muda.
- O cache não é prova de atualidade nem base de auditoria. As rotinas podem repetir consultas se houver perda; não devem criar commits apenas por reconsultar conteúdo idêntico. Ver logs e cobertura antes de homologar metas de atualização.
- Escopo atual: atas PNCP, vínculos de NE em contratos PNCP e históricos de itens CGU. Demais documentos e vínculos ainda precisam de manutenção periódica. Reversão por revert do PR.

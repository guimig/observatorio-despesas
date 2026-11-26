# Política de retenção e crescimento — Observatório de Despesas

## Preservação
- Dados canônicos desde 01/01/2024: preservar permanentemente no recorte; não usar janela móvel, TTL, expurgo automático ou reescrita do histórico Git.
- Alterações materiais, inclusive um centavo, nova evidência de cobertura, vínculos, retificações, situação, vigência, classificação e textos oficiais: registrar. Sem tolerância monetária.
- Primeira conferência concluída (inclusive resultado vazio confirmado): conservar; novas conferências idênticas podem ficar somente no estado operacional com hash da evidência. Datas canônicas não são prova de última consulta efetiva.
- Nenhum PDF, resposta bruta, segredo ou dado pessoal não minimizado; links oficiais e metadados mínimos. Cache descartável até 1 MiB/10 mil entradas/90 dias lógicos por coletor; sem aumento de quota. Perder cache apenas antecipa reconsulta.

## Manutenção
- Workflow `retencao.yml` diariamente às 05:17 UTC: mede árvore, dados, maiores JSONs, Git, commits, branches, caches e artefatos. Não cria commits de métricas. Informação inacessível = indisponível, nunca zero.
- Artefato Pages: um dia explicitamente. Retenção de logs desejada: 30 dias (ajuste nativo em Settings > Actions > General; relatório indica valor efetivo informado ao runner). Não apagar execuções/diagnósticos manualmente por idade.
- Limpeza pós-merge e diária de até 50 branches: somente PR mesclado neste repositório com base main, SHA exato da head, merge ancestral da main, branch não protegida nem referida por PR aberto. Lease do Git impede apagar branch alterada. Manualmente `workflow_dispatch` inicia em simulação por padrão; resumo guarda SHA/ref para eventual recuperação. Não reescrever main nem usar force-push em main.
- Preferir adicionalmente habilitar a opção nativa de exclusão automática pós-merge em Settings > General quando houver acesso administrativo à configuração.
- Limites preventivos (MB decimais): maior JSON 0,75/1; dados 25/50; Git informado 50/100; caches 100/250; branches elegíveis 20/50; artefato Pages 5/10. Alerta/revisão, não exclusão.
- Se JSON individual superar 750 KB, medir latência e preparar partição anual dos catálogos PNCP e carregamento sob demanda. Não migrar dados ou schema agora. 

## Reversão
Reverter PR restaura política anterior dos coletores e desativa o workflow; checkpoints descartáveis podem expirar normalmente. Para restaurar uma referência removida, criar branch no SHA registrado no resumo da execução (se disponível). Commits integrados permanecem na main. A política não substitui guarda oficial de documentos pelo IFC.

/** Enriquecimento independente dos documentos, com checkpoint no próprio JSON mensal. */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateManifest, validateMonth, persistEnrichment,
  validatePublishedData } from './store.mjs';
import { resolveLiquidationLinks, resolvePaymentLinks, resolveItems } from './enrich-cgu.mjs';

function bounded(value,fallback,max){
  const n=Number(value||fallback);
  if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('Limite de lote inválido');
  return n;
}
export function planEnrichment(month,{maxLiquidations=12,maxPayments=15,maxItems=7}={}){
  validateMonth(month);
  const liquidations=month.documents.filter(doc=>doc.phase===2&&
    doc.liquidationLinksChecked!==true)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .slice(0,bounded(maxLiquidations,12,40)).map(doc=>doc.id);
  const payments=month.documents.filter(doc=>doc.phase===3&&doc.paymentLinksChecked!==true)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .slice(0,bounded(maxPayments,15,50)).map(doc=>doc.id);
  const items=month.documents.filter(doc=>doc.phase===1&&
    !Object.hasOwn(month.itemsByDocument||{},doc.id))
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .slice(0,bounded(maxItems,7,20)).map(doc=>doc.id);
  return {liquidations,payments,items};
}
export function summarizeFailures(failures){
  const counts={};
  for(const reason of failures){
    const key=['consulta_indisponivel','resposta_invalida','pagina_repetida',
      'limite_paginacao','impacto_nao_identificado','valor_fora_limite',
      'item_invalido','sequencial_duplicado_divergente','persistencia_invalida',
      'acesso_negado','recurso_nao_encontrado','erro_http'].includes(reason)
      ?reason:'outro';
    counts[key]=(counts[key]||0)+1;
  }
  return counts;
}
async function readMonth(root,month){
  const path=join(root,'data','months',month+'.json');
  return validateMonth(JSON.parse(await readFile(path,'utf8')));
}
async function main(){
  const root=process.cwd();
  const manifest=validateManifest(JSON.parse(await readFile(join(root,'data','manifest.json'),'utf8')));
  const selected=process.env.ENRICH_MONTH||'';
  if(selected&&!manifest.months.includes(selected))throw Error('Competência não disponível');
  const args={
    maxLiquidations:process.env.ENRICH_LIQUIDATIONS||12,
    maxPayments:process.env.ENRICH_PAYMENTS||15,
    maxItems:process.env.ENRICH_ITEMS||7
  };
  const priority=process.env.ENRICH_PRIORITY==='oldest'?'oldest':'newest';
  // A agenda alterna o mês mais recente e o mais antigo para impedir que
  // novos documentos deixem competências históricas sempre aguardando.
  const alternatives=selected?[selected]:[...manifest.months].sort();
  if(priority==='newest'&&!selected)alternatives.reverse();
  let chosen=null;
  for(const monthName of alternatives){
    const data=await readMonth(root,monthName);
    const plan=planEnrichment(data,args);
    if(plan.liquidations.length||plan.payments.length||plan.items.length){
      chosen={monthName,plan};break;
    }
  }
  if(!chosen){
    console.log('Acervo sem documentos pendentes de enriquecimento.');
    return;
  }
  console.log('Plano de enriquecimento: competência '+chosen.monthName+'; '+
    chosen.plan.liquidations.length+' liquidações; '+chosen.plan.payments.length+
    ' pagamentos; '+chosen.plan.items.length+' empenhos.');
  if(process.argv.includes('--dry-run')){
    console.log('Simulação: nenhuma consulta autenticada ou arquivo alterado.');
    return;
  }
  const token=process.env.CGU_API_KEY;
  if(!token)throw Error('CGU_API_KEY não disponível');
  let successes=0,errors=0,links=0,items=0;
  const failures=[];
  for(const [kind,docs] of [['liquidation',chosen.plan.liquidations],
    ['payment',chosen.plan.payments],['items',chosen.plan.items]]){
    for(const id of docs){
      const outcome=kind==='liquidation'?await resolveLiquidationLinks(id,{token}):
        kind==='payment'?await resolvePaymentLinks(id,{token}):await resolveItems(id,{token});
      if(!outcome.ok){
        failures.push(outcome.reason||'outro');
        errors++;
        continue;
      }
      const result=kind==='items'?{kind:'items',items:outcome.items}:
        {kind,links:outcome.links};
      try{
        await persistEnrichment(root,chosen.monthName,id,result,new Date());
      }catch{
        failures.push('persistencia_invalida');
        errors++;
        continue;
      }
      successes++;
      links+=outcome.links?.length||0;
      items+=outcome.items?.length||0;
    }
  }
  await validatePublishedData(root);
  console.log('Motivos de consultas não concluídas (somente contagens, sem IDs ou respostas): '+
    JSON.stringify(summarizeFailures(failures)));
  console.log('Enriquecimento CGU (liquidações, pagamentos e itens): '+successes+' documento(s) concluído(s), '+
    errors+' sem conclusão; '+links+' vínculo(s) de liquidação/pagamento e '+
    items+' item(ns) de empenho. Respostas brutas e dados pessoais não persistidos.');
  if(!successes&&errors)throw Error('Não foi possível completar nenhuma consulta');
}
if(process.argv[1] && import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  main().catch(()=>{
    console.error('Enriquecimento não concluído; checkpoints anteriores permanecem preservados.');
    process.exitCode=1;
  });
}

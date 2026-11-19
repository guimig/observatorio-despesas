/** Enriquecimento independente dos documentos, com checkpoint no próprio JSON mensal. */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateManifest, validateMonth, persistEnrichment,
  validatePublishedData } from './store.mjs';
import { resolvePaymentLinks, resolveItems } from './enrich-cgu.mjs';

function bounded(value,fallback,max){
  const n=Number(value||fallback);
  if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('Limite de lote inválido');
  return n;
}
export function planEnrichment(month,{maxPayments=15,maxItems=7}={}){
  validateMonth(month);
  const payments=month.documents.filter(doc=>doc.phase===3&&doc.paymentLinksChecked!==true)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .slice(0,bounded(maxPayments,15,50)).map(doc=>doc.id);
  const items=month.documents.filter(doc=>doc.phase===1&&
    !Object.hasOwn(month.itemsByDocument||{},doc.id))
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .slice(0,bounded(maxItems,7,20)).map(doc=>doc.id);
  return {payments,items};
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
    maxPayments:process.env.ENRICH_PAYMENTS||15,
    maxItems:process.env.ENRICH_ITEMS||7
  };
  const alternatives=selected?[selected]:[...manifest.months].sort().reverse();
  let chosen=null;
  for(const monthName of alternatives){
    const data=await readMonth(root,monthName);
    const plan=planEnrichment(data,args);
    if(plan.payments.length||plan.items.length){
      chosen={monthName,plan};break;
    }
  }
  if(!chosen){
    console.log('Acervo sem documentos pendentes de enriquecimento.');
    return;
  }
  console.log('Plano de enriquecimento: competência '+chosen.monthName+'; '+
    chosen.plan.payments.length+' pagamentos; '+chosen.plan.items.length+' empenhos.');
  if(process.argv.includes('--dry-run')){
    console.log('Simulação: nenhuma consulta autenticada ou arquivo alterado.');
    return;
  }
  const token=process.env.CGU_API_KEY;
  if(!token)throw Error('CGU_API_KEY não disponível');
  let successes=0,errors=0,links=0,items=0;
  for(const [kind,docs] of [['payment',chosen.plan.payments],['items',chosen.plan.items]]){
    for(const id of docs){
      const outcome=kind==='payment'
        ?await resolvePaymentLinks(id,{token})
        :await resolveItems(id,{token});
      if(!outcome.ok){
        errors++;
        continue;
      }
      const result=kind==='payment'
        ?{kind:'payment',links:outcome.links}
        :{kind:'items',items:outcome.items};
      await persistEnrichment(root,chosen.monthName,id,result,new Date());
      successes++;
      links+=outcome.links?.length||0;
      items+=outcome.items?.length||0;
    }
  }
  await validatePublishedData(root);
  console.log('Enriquecimento CGU: '+successes+' documento(s) concluído(s), '+
    errors+' sem conclusão; '+links+' vínculo(s) de pagamento e '+
    items+' item(ns) de empenho. Respostas brutas e dados pessoais não persistidos.');
  if(!successes&&errors)throw Error('Não foi possível completar nenhuma consulta');
}
if(process.argv[1] && import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  main().catch(()=>{
    console.error('Enriquecimento não concluído; checkpoints anteriores permanecem preservados.');
    process.exitCode=1;
  });
}

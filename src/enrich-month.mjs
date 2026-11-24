/** Enriquecimento independente dos documentos, com checkpoint no próprio JSON mensal. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {createCguBudget} from './cgu-budget.mjs';
import {inScopeMonth} from './collection-scope.mjs';
import {stateKey,validDay,readOperationalState,saveOperationalState} from './operational-state.mjs';
import { join, resolve } from 'node:path';
import { validateManifest, validateMonth, persistEnrichment,
  validatePublishedData } from './store.mjs';
import { resolveLiquidationLinks, resolvePaymentLinks, resolveItems } from './enrich-cgu.mjs';
import {resolveItemMovements} from './item-movements.mjs';

function bounded(value,fallback,max){
  const n=Number(value||fallback);
  if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('Limite de lote inválido');
  return n;
}
export function rotatePending(documents,limit,slot=0){
  if(!Number.isSafeInteger(slot)||slot<0)throw Error('Rodada de enriquecimento inválida');
  if(!documents.length)return [];
  const offset=(slot*limit)%documents.length;
  return [...documents.slice(offset),...documents.slice(0,offset)].slice(0,limit);
}
export function historyKey(doc,item){
 return createHash('sha256').update(JSON.stringify([doc.id,doc.cents,item])).digest('hex');
}
export function historyCheckpoint(doc,item,state,today){
 const cached=state[historyKey(doc,item)];
 return typeof cached==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(cached)&&cached<=today&&cached>(item.historyCheckedAt||'')
  ?cached:item.historyCheckedAt;
}
export function planEnrichment(month,{maxLiquidations=12,maxPayments=15,maxItems=7,maxItemHistories=10,maxHistoryRechecks=2,now=new Date(),slot=0,historyState={}}={}){
  validateMonth(month);
  const liquidations=month.documents.filter(doc=>doc.phase===2&&
    doc.liquidationLinksChecked!==true)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .map(doc=>doc.id);
  const selectedLiquidations=rotatePending(liquidations,bounded(maxLiquidations,12,40),slot);
  const payments=month.documents.filter(doc=>doc.phase===3&&doc.paymentLinksChecked!==true)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .map(doc=>doc.id);
  const selectedPayments=rotatePending(payments,bounded(maxPayments,15,50),slot);
  const items=month.documents.filter(doc=>doc.phase===1&&
    (!Object.hasOwn(month.itemsByDocument||{},doc.id)||doc.itemsDetailVersion!==2))
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .map(doc=>doc.id);
  const selectedItems=rotatePending(items,bounded(maxItems,7,20),slot);
  // Uma nota com historico parcialmente validado deve poder ser concluida
  // antes de se iniciar uma nova rodada de notas ainda inteiramente pendentes.
  // Reservar no maximo um terco do lote preserva rodizio e evita monopolizacao.
  const partialHistories=[],newHistories=[];
  for(const doc of month.documents.filter(doc=>doc.phase===1&&doc.itemsDetailVersion===2)){
    const all=month.itemsByDocument?.[doc.id]||[];
    const pending=all.filter(item=>item.historyChecked!==true);
    const destination=all.some(item=>item.historyChecked===true)?
      partialHistories:newHistories;
    for(const item of pending)destination.push({id:doc.id,seq:item.seq});
  }
  const sorter=(a,b)=>a.id.localeCompare(b.id)||a.seq-b.seq;
  partialHistories.sort(sorter);
  newHistories.sort(sorter);
  const historyLimit=bounded(maxItemHistories,10,30);
  const partialQuota=Math.max(1,Math.floor(historyLimit/3));
  const prioritized=rotatePending(partialHistories,Math.min(partialQuota,partialHistories.length),slot);
  const regular=rotatePending(newHistories,historyLimit-prioritized.length,slot);
  const selectedHistories=[...prioritized,...regular];
  if(selectedHistories.length<historyLimit){
    const selected=new Set(selectedHistories.map(item=>item.id+'/'+item.seq));
    selectedHistories.push(...rotatePending(partialHistories.filter(item=>
      !selected.has(item.id+'/'+item.seq)),historyLimit-selectedHistories.length,slot));
  }
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('Data de revisao invalida');
  const today=now.toISOString().slice(0,10);
  const nowDay=Date.parse(today+'T00:00:00Z');
  const referenceYear=Number(today.slice(0,4));
  const rechecks=[];
  for(const doc of month.documents.filter(doc=>doc.phase===1&&doc.itemsDetailVersion===2)){
    // A CGU pode registrar movimentacoes posteriores ao exercicio da NE;
    // por isso as NEs antigas precisam de revisao mais frequente.
    const commitmentYear=Number(doc.id.slice(11,15));
    const intervalDays=commitmentYear<referenceYear?7:14;
    for(const item of month.itemsByDocument?.[doc.id]||[]){
      if(item.historyChecked!==true)continue;
      const last=historyCheckpoint(doc,item,historyState,today);
      const lastDay=last?Date.parse(last+'T00:00:00Z'):NaN;
      // Historico inicialmente vazio NAO e final: a CGU pode atualiza-lo.
      // Checkpoints legados sem data ou invalidos tambem sao elegiveis.
      if(!last||!Number.isFinite(lastDay)||
         nowDay-lastDay>=intervalDays*86400000)
        rechecks.push({id:doc.id,seq:item.seq,last:last||''});
    }
  }
  // Revisar primeiro checkpoints antigos/sem data, com rodizio para
  // que uma consulta permanentemente indisponivel nao monopolize a fila.
  rechecks.sort((a,b)=>a.last.localeCompare(b.last)||
    a.id.localeCompare(b.id)||a.seq-b.seq);
  const selectedRechecks=rotatePending(rechecks,
    bounded(maxHistoryRechecks,2,8),slot).map(({id,seq})=>({id,seq}));
  return {liquidations:selectedLiquidations,payments:selectedPayments,
    items:selectedItems,itemHistories:selectedHistories,itemRechecks:selectedRechecks};
}
export function scheduledMonthSlot(now=new Date()){
  const date=now instanceof Date?now:new Date(now);
  if(!Number.isFinite(date.getTime()))throw Error('Data de agendamento inválida');
  // Um avanço por dia; os três agendamentos do dia usam a mesma competência.
  // Isso garante alternância diária mesmo quando o slot de seis horas
  // produziria sempre o mesmo resto para três competências.
  return Math.floor(date.getTime()/86400000);
}
export function orderMonths(months,{priority='newest',slot=0}={}){
  const ordered=[...months].sort();
  if(priority==='round_robin'){
    if(!Number.isSafeInteger(slot)||slot<0)throw Error('Rodada de competência inválida');
    if(!ordered.length)return [];
    const start=slot%ordered.length;
    return [...ordered.slice(start),...ordered.slice(0,start)];
  }
  if(priority==='newest')ordered.reverse();
  return ordered;
}
/** Checkpoint por tipo de consulta e conteudo confirmado, nao pela data de gravacao mensal. */
export function detailKey(month,id,kind){
 const doc=month.documents.find(d=>d.id===id);
 if(!doc)throw Error('Documento de consulta ausente');
 const rows=kind==='items'?(month.itemsByDocument?.[id]||[]).map(({historyChecked,historyCheckedAt,movements,...item})=>item):
   month.relations.filter(r=>r.from===id);
 return stateKey(['cgu-detail',kind,id,doc.cents,rows]);
}
function roundRobin(groups,limit){
 const q=groups.map(g=>[...g]),result=[];
 while(result.length<limit&&q.some(g=>g.length)){
  for(const group of q){if(group.length)result.push(group.shift());if(result.length===limit)break;}
 }
 return result;
}
export function planDetailRechecks(month,{state={},now=new Date(),slot=0,limit=2}={}){
 const today=now.toISOString().slice(0,10),cutoff=new Date(now.getTime()-30*86400000).toISOString().slice(0,10);
 const lists={liquidation:[],payment:[],items:[]};
 for(const doc of month.documents){
  const kind=doc.phase===1&&doc.itemsDetailVersion===2&&Object.hasOwn(month.itemsByDocument||{},doc.id)?'items':
   doc.phase===2&&doc.liquidationLinksChecked===true?'liquidation':
   doc.phase===3&&doc.paymentLinksChecked===true?'payment':null;
  if(!kind)continue;
  const last=state[detailKey(month,doc.id,kind)];
  if(validDay(last)&&last>cutoff&&last<=today)continue;
  lists[kind].push({month:month.month,id:doc.id,kind,recheck:true,last:validDay(last)&&last<=today?last:''});
 }
 for(const kind of Object.keys(lists)){
  const candidates=lists[kind].sort((a,b)=>a.last.localeCompare(b.last)||a.id.localeCompare(b.id));
  const first=candidates[0]?.last||'';
  const same=candidates.filter(x=>x.last===first),others=candidates.filter(x=>x.last!==first);
  lists[kind]=[...rotatePending(same,Math.min(limit,same.length),slot),...others].slice(0,limit);
 }
 return lists;
}
export function planEnrichmentAcrossMonths(months,args={}, {review=false}={}){
 const plans=months.filter(m=>inScopeMonth(m.month)).map(m=>({month:m,plan:planEnrichment(m,args),
  review:review?planDetailRechecks(m,{state:args.historyState||{},now:args.now||new Date(),slot:args.slot||0}):{}}));
 const specs=[['liquidations','liquidation',bounded(args.maxLiquidations,12,40)],['payments','payment',bounded(args.maxPayments,15,50)],
  ['items','items',bounded(args.maxItems,7,20)],['itemHistories','itemHistory',bounded(args.maxItemHistories,10,30)],
  ['itemRechecks','itemHistory',bounded(args.maxHistoryRechecks,2,8)]];
 const queues=specs.map(([key,kind,limit])=>roundRobin(plans.map(({month,plan})=>plan[key].map(item=>
  kind==='itemHistory'?{month:month.month,kind,...item,recheck:key==='itemRechecks'}:{month:month.month,kind,id:item})),limit));
 if(review)for(const kind of ['liquidation','payment','items']){
  const occupied=new Set(queues.flat().filter(t=>t.kind==='itemHistory').map(t=>t.id));
  const eligible=plans.map(p=>(p.review[kind]||[]).filter(t=>kind!=='items'||!occupied.has(t.id)));
  queues.push(roundRobin(eligible,2));
 }
 return roundRobin(queues,queues.reduce((n,q)=>n+q.length,0));
}
export function summarizeFailures(failures){
  const counts={};
  for(const reason of failures){
    const key=['consulta_indisponivel','resposta_invalida','pagina_repetida',
      'limite_paginacao','impacto_nao_identificado','valor_fora_limite',
      'item_invalido','movimentacao_invalida','sequencial_duplicado_divergente','persistencia_invalida',
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
  // Rodadas de seis horas evitam repetir indefinidamente os primeiros IDs
  // sem manter histórico adicional de tentativas em arquivos públicos.
  const slot=Math.floor(Date.now()/21600000);
  const statePath=process.env.CGU_HISTORY_STATE_PATH;
  const historyState=await readOperationalState(statePath);
  const args={slot,historyState,
    maxLiquidations:process.env.ENRICH_LIQUIDATIONS||12,
    maxPayments:process.env.ENRICH_PAYMENTS||15,
    maxItems:process.env.ENRICH_ITEMS||7,
    maxItemHistories:process.env.ENRICH_HISTORY_ITEMS||10,
    maxHistoryRechecks:process.env.ENRICH_HISTORY_RECHECKS||2
  };
  const priority=['oldest','newest','round_robin'].includes(process.env.ENRICH_PRIORITY)
    ?process.env.ENRICH_PRIORITY:'newest';
  // A agenda alterna o mês mais recente e o mais antigo para impedir que
  // novos documentos deixem competências históricas sempre aguardando.
  const monthSlot=scheduledMonthSlot();
  const alternatives=selected?[selected]:orderMonths(manifest.months,{priority,slot:monthSlot});
  const months=[];
  for(const monthName of alternatives)if(inScopeMonth(monthName))months.push(await readMonth(root,monthName));
  const tasks=planEnrichmentAcrossMonths(months,args,{review:Boolean(statePath)});
  if(!tasks.length){
    console.log('Acervo sem documentos pendentes de enriquecimento.');
    return;
  }
  const planned={};
  for(const task of tasks){const key=task.kind+(task.recheck?'Review':'Pending');planned[key]=(planned[key]||0)+1;}
  console.log('Plano de enriquecimento multicompetencia: '+JSON.stringify({months:new Set(tasks.map(t=>t.month)).size,planned,total:tasks.length}));
  if(process.argv.includes('--dry-run')){
    console.log('Simulação: nenhuma consulta autenticada ou arquivo alterado.');
    return;
  }
  const token=process.env.CGU_API_KEY;
  if(!token)throw Error('CGU_API_KEY não disponível');
  const budget=createCguBudget();
  let successes=0,errors=0,links=0,items=0,attempted=0,completedReviews=0;
  const failures=[];
  for(const task of tasks){
    if(budget.stopped())break;
    const {kind,id,month,seq,recheck}=task;
    const before=await readMonth(root,month);
    const doc=before.documents.find(d=>d.id===id);
    const old=kind==='itemHistory'?before.itemsByDocument?.[id]?.find(x=>x.seq===seq):null;
    if(!doc||kind==='itemHistory'&&!old)continue;
    attempted++;
    const outcome=kind==='liquidation'?await resolveLiquidationLinks(id,{token,budget}):
      kind==='payment'?await resolvePaymentLinks(id,{token,budget}):
      kind==='items'?await resolveItems(id,{token,budget}):await resolveItemMovements(id,seq,{token,budget});
    if(!outcome.ok){failures.push(outcome.reason||'outro');errors++;continue;}
    const result=kind==='items'?{kind,items:outcome.items,recheck}:
      kind==='itemHistory'?{kind,seq,movements:outcome.movements,checkedAt:new Date().toISOString().slice(0,10)}:
        {kind,links:outcome.links};
    try{
      if(statePath&&kind==='itemHistory'&&old.historyChecked===true&&JSON.stringify(old.movements)===JSON.stringify(result.movements))
        delete result.checkedAt;
      if(kind==='liquidation'&&doc.cents===null&&outcome.links.length&&before.coverage.some(c=>c.date===doc.date&&c.phase===2&&c.complete)){
        const total=outcome.links.reduce((n,l)=>n+BigInt(l.cents),0n);
        if(total<=BigInt(Number.MAX_SAFE_INTEGER)&&total>=BigInt(Number.MIN_SAFE_INTEGER)){
          result.kind='liquidationValue';result.cents=Number(total);
        }
      }
      await persistEnrichment(root,month,id,result,new Date());
      if(statePath){
        const after=await readMonth(root,month);
        const updated=after.documents.find(d=>d.id===id);
        const previousKey=kind==='itemHistory'?historyKey(doc,old):detailKey(before,id,kind);
        const currentKey=kind==='itemHistory'?historyKey(updated,after.itemsByDocument[id].find(x=>x.seq===seq)):detailKey(after,id,kind);
        delete historyState[previousKey];
        historyState[currentKey]=new Date().toISOString().slice(0,10);
      }
    }catch{failures.push('persistencia_invalida');errors++;continue;}
    successes++;if(recheck)completedReviews++;
    links+=outcome.links?.length||0;items+=outcome.items?.length||0;
  }
  console.log('Telemetria enriquecimento CGU: '+JSON.stringify({planned:tasks.length,attempted,successes,errors,completedReviews,...budget.snapshot()}));
  await validatePublishedData(root);
  await saveOperationalState(statePath,historyState);
  console.log('Motivos de consultas não concluídas (somente contagens, sem IDs ou respostas): '+
    JSON.stringify(summarizeFailures(failures)));
  console.log('Enriquecimento CGU (liquidações, pagamentos e itens): '+successes+' documento(s) concluído(s), '+
    errors+' sem conclusão; '+links+' vínculo(s) de liquidação/pagamento e '+
    items+' item(ns) de empenho. Historicos de itens sao processados separadamente. '+
    'Respostas brutas e dados pessoais não persistidos.');
  if(!successes&&errors)throw Error('Não foi possível completar nenhuma consulta');
}
if(process.argv[1] && import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  main().catch(()=>{
    console.error('Enriquecimento não concluído; checkpoints anteriores permanecem preservados.');
    process.exitCode=1;
  });
}

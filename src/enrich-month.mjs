/** Enriquecimento independente dos documentos, com checkpoint no próprio JSON mensal. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {createCguBudget,collectionLimits,assessCollectionCapacity} from './cgu-budget.mjs';
import {readCguContractEvidence} from './cgu-contract-evidence.mjs';
import {validRelatedPair} from '../assets/trajectory.js';
import {buildIntegratedIndex,cguContractExecutionEvidence} from '../assets/integrated-trajectory.js';
import {inScopeMonth,inScopeNe} from './collection-scope.mjs';
import {stateKey,validDay,readOperationalState,saveOperationalState} from './operational-state.mjs';
import { join, resolve } from 'node:path';
import { validateManifest, validateMonth, persistEnrichment,
  validatePublishedData } from './store.mjs';
import { resolveLiquidationLinks, resolvePaymentLinks, resolveItems } from './enrich-cgu.mjs';
import {resolveItemMovements} from './item-movements.mjs';
import {summarizeRapEvidence,needsRapComponentReview,IMPACT_FIELDS} from './rap-evidence.mjs';
import {buildRapTrajectories,summarizeRapReadiness} from '../assets/rap-trajectory.js';
import {buildCommitmentChronology,indexCommitmentChronology,summarizeCommitmentValues} from '../assets/siafi-movement-reconciliation.js';
import {currentDateInBrazil} from './backfill.mjs';
import {summarizeStoredValueMeanings} from './cgu-value-semantics.mjs';
import {planDivergenceProbes,runDivergenceProbes} from './cgu-divergence-probe.mjs';
import {planChronologyEnrichment,chronologyAttemptKey,requiresCanonicalHistoryCheckpoint,promoteCatalogHistories,summarizeCatalogDivergences,summarizeCatalogBacklog,needsInitialCatalog,catalogPaginationKey,catalogPageLimit,summarizeHistoryBacklog,historyPaginationKey,historyPageLimit} from './chronology-enrichment.mjs';

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
  const available=(doc,kind)=>!recentImpactAttempt(month,doc.id,kind,historyState,now);
  const liquidations=month.documents.filter(doc=>doc.phase===2&&
    doc.liquidationLinksChecked!==true&&available(doc,'liquidation'))
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .map(doc=>doc.id);
  const selectedLiquidations=rotatePending(liquidations,bounded(maxLiquidations,12,40),slot);
  const payments=month.documents.filter(doc=>doc.phase===3&&doc.paymentLinksChecked!==true&&available(doc,'payment'))
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .map(doc=>doc.id);
  const selectedPayments=rotatePending(payments,bounded(maxPayments,15,50),slot);
  const items=month.documents.filter(doc=>doc.phase===1&&inScopeNe(doc.id)&&
    (!Object.hasOwn(month.itemsByDocument||{},doc.id)||doc.itemsDetailVersion!==2))
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
    .map(doc=>doc.id);
  const selectedItems=rotatePending(items,bounded(maxItems,7,20),slot);
  // Uma nota com historico parcialmente validado deve poder ser concluida
  // antes de se iniciar uma nova rodada de notas ainda inteiramente pendentes.
  // Reservar no maximo um terco do lote preserva rodizio e evita monopolizacao.
  const partialHistories=[],newHistories=[];
  for(const doc of month.documents.filter(doc=>doc.phase===1&&inScopeNe(doc.id)&&doc.itemsDetailVersion===2)){
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
  for(const doc of month.documents.filter(doc=>doc.phase===1&&inScopeNe(doc.id)&&doc.itemsDetailVersion===2)){
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
 const rapPriority=new Set(month.relations.filter(needsRapComponentReview).map(r=>r.from));
 for(const doc of month.documents){
  const kind=doc.phase===1&&inScopeNe(doc.id)&&doc.itemsDetailVersion===2&&Object.hasOwn(month.itemsByDocument||{},doc.id)?'items':
   doc.phase===2&&doc.liquidationLinksChecked===true?'liquidation':
   doc.phase===3&&doc.paymentLinksChecked===true?'payment':null;
  if(!kind)continue;
  if(kind!=='items'&&recentImpactAttempt(month,doc.id,kind,state,now))continue;
  const last=state[detailKey(month,doc.id,kind)];
  if(validDay(last)&&last>cutoff&&last<=today)continue;
  lists[kind].push({month:month.month,id:doc.id,kind,recheck:true,last:validDay(last)&&last<=today?last:''});
 }
 for(const kind of Object.keys(lists)){
  const candidates=lists[kind].sort((a,b)=>a.last.localeCompare(b.last)||a.id.localeCompare(b.id));
  const first=candidates[0]?.last||'';
  const same=candidates.filter(x=>x.last===first),others=candidates.filter(x=>x.last!==first);
  const normal=[...rotatePending(same,Math.min(limit,same.length),slot),...others];
  // Reserva uma vaga de revisão já existente, sem aumentar a cota.
  const candidatesRap=kind==='items'?[]:candidates.filter(t=>rapPriority.has(t.id));
  const preferred=rotatePending(candidatesRap,1,slot);
  lists[kind]=[...preferred,...normal.filter(t=>!preferred.some(p=>p.id===t.id))].slice(0,limit);
 }
 return lists;
}
/** Usa evidencias de identidade CGU para completar impactos ainda sem valor.
 * Reserva ate 40% das vagas (minimo uma); usa uma vaga ociosa quando
 * nao ha tarefas regulares na fase. Preserva teto configurado e rodizio. */
export function impactAttemptKey(month,id,kind){
 return stateKey(['cgu-impact-attempt-v1',detailKey(month,id,kind)]);
}
export function recentImpactAttempt(month,id,kind,state={},now=new Date()){
 const today=now.toISOString().slice(0,10),stamp=state[impactAttemptKey(month,id,kind)];
 return validDay(stamp)&&stamp<=today&&Date.parse(today)-Date.parse(stamp)<2*86400000;
}
/** Diagnostico comparavel por contrato; nao agrega valores financeiros. */
export function summarizeContractProgress(months,cguContracts){
 const index=buildIntegratedIndex({months,cguContracts,totalMonths:months.length});
 const out={contracts:cguContracts.length,eligible:0,reconciled:0,knownLiquidationPairs:0,unknownLiquidationPairs:0,knownPaymentPairs:0,unknownPaymentPairs:0};
 for(const c of cguContracts){
  const e=cguContractExecutionEvidence(index,c.id);
  out.eligible+=e.eligible;out.reconciled+=e.reconciled;
  out.knownLiquidationPairs+=e.liquidation.known;out.unknownLiquidationPairs+=e.liquidation.unknown;
  out.knownPaymentPairs+=e.payment.known;out.unknownPaymentPairs+=e.payment.unknown;
 }
 return out;
}
export function prioritizeRelatedImpacts(base,months,{slot=0,state={},now=new Date(),cguContracts=[]}={}){
 const today=now.toISOString().slice(0,10);
 const recent=(stamp,days)=>validDay(stamp)&&stamp<=today&&Date.parse(today)-Date.parse(stamp)<days*86400000;
 const docs=new Map(),pairs=new Set(),wanted=new Map(),refCounts=new Map();
 for(const c of cguContracts)for(const ne of new Set((c.refs||[]).filter(inScopeNe)))refCounts.set(ne,(refCounts.get(ne)||0)+1);
 const contractNe=new Set([...refCounts].filter(([,n])=>n===1).map(([id])=>id));
 for(const m of months){for(const d of m.documents){if(!docs.has(d.id))docs.set(d.id,[]);docs.get(d.id).push({doc:d,month:m});}
 }
 for(const m of months)for(const r of m.relations){
  const found=docs.get(r.from);
  if(found?.length===1&&Number.isSafeInteger(r.cents)&&
   (found[0].doc.phase===3?found[0].doc.paymentLinksChecked===true:found[0].doc.liquidationLinksChecked===true))pairs.add(r.from+'>'+r.to);
 }
 for(const [id,rows] of docs)if(rows.length===1){
  const d=rows[0].doc;
  for(const other of d.relatedIds||[]){
   if(!validRelatedPair(id,other))continue;
   const ne=d.phase===1?id:other,from=d.phase===1?other:id;
   if(!/^158459\d{5}20\d{2}NE\d{6}$/.test(ne)||!inScopeNe(ne)||pairs.has(from+'>'+ne))continue;
   const found=docs.get(from);if(found?.length!==1||![2,3].includes(found[0].doc.phase))continue;
   const {doc,month}=found[0],kind=doc.phase===2?'liquidation':'payment';
   const recheck=doc.phase===2?doc.liquidationLinksChecked===true:doc.paymentLinksChecked===true;
   const last=state[detailKey(month,from,kind)];
   if(recent(last,7)||recentImpactAttempt(month,from,kind,state,now))continue;
   if(!wanted.has(from))wanted.set(from,{kind,id:from,month:month.month,recheck,missing:new Set(),contract:false});
   const task=wanted.get(from);task.missing.add(ne);task.contract ||= contractNe.has(ne);
  }
 }
 const queue=base.filter(t=>{
  if(!['payment','liquidation'].includes(t.kind))return true;
  const rows=docs.get(t.id);
  return !rows||rows.length===1&&!recentImpactAttempt(rows[0].month,t.id,t.kind,state,now);
 }),selected=[];
 for(const kind of ['payment','liquidation']){
  const candidates=[...wanted.values()].filter(t=>t.kind===kind);
  const regularSlots=queue.filter(t=>t.kind===kind).length;
  // A ausencia de documentos novos nao encerra a fila de impactos.
  // Usar uma vaga ociosa da fase ou reservar uma quando o lote e pequeno.
  const quota=Math.min(candidates.length,Math.max(1,Math.floor(regularSlots*.4)));
  if(!quota)continue;
  const ordered=xs=>xs.sort((a,b)=>b.missing.size-a.missing.size||a.id.localeCompare(b.id));
  const strong=ordered(candidates.filter(t=>t.contract)),other=ordered(candidates.filter(t=>!t.contract));
  // Ate dois tercos da reserva documental atendem contratos CGU; o restante continua
  // no rodizio geral. Offset usa a cota, nao o tamanho integral do grupo.
  const rotate=xs=>{if(!xs.length)return [];const offset=slot%xs.length;return xs.slice(offset).concat(xs.slice(0,offset));};
  const high=rotate(strong),general=rotate(other),first=high.slice(0,Math.ceil(quota*2/3));
  const targets=[...first,...general,...high.slice(first.length)];
  const chosen=targets.slice(0,quota);
  for(const t of chosen){
   let at=queue.findIndex(x=>x.kind===kind&&x.id===t.id);
   if(at<0)at=queue.findLastIndex(x=>x.kind===kind&&!chosen.some(y=>y.id===x.id));
   if(at<0&&regularSlots>0)continue;
   if(at>=0)queue.splice(at,1);
   selected.push(t);
  }
 }
 // Mantem tipos intercalados; no maximo uma vaga ociosa por fase.
 return {tasks:roundRobin(['items','itemHistory','payment','liquidation'].map(k=>[...selected.map(({missing,contract,...t})=>t),...queue].filter(t=>t.kind===k)),queue.length+selected.length),selected:selected.length,contractPriority:selected.filter(t=>t.contract).length,paymentPriority:selected.filter(t=>t.kind==='payment').length,contractPendingDocuments:[...wanted.values()].filter(t=>t.contract).length,contractPendingPaymentPairs:[...wanted.values()].filter(t=>t.kind==='payment').reduce((n,t)=>n+[...t.missing].filter(ne=>contractNe.has(ne)).length,0),
 protectedIds:selected.map(t=>t.id)};
}
/** Reserva global para recuperar componentes de RAP, sem ampliar filas ou
 * substituir vínculos documentais explicitamente priorizados. Primeiro os
 * pares legados sem qualquer componente; os parciais seguem revisão normal. */
export function prioritizeRapComponentRecovery(base,months,{state={},now=new Date(),slot=0,protectedIds=[],totalMonths=months.length}={}){
 const owners=new Map(),candidates=[],pendingByDoc=new Map();
 const trajectories=buildRapTrajectories(months,{today:currentDateInBrazil(now),totalMonths});
 const readiness=summarizeRapReadiness(trajectories);
 // A cobertura de listagem é global; uma consulta de impacto não a resolve.
 // Identificar apenas o potencial de sanar a última lacuna financeira conhecida.
 const globalReasons=new Set(['months_missing','listing_unknown','listing_partial','impacts_incomplete']);
 const finalGap=(entry,id)=>entry?.explicitRapEvidence&&entry.originStatus==='collected'&&
  entry.readiness.reasons.includes('impacts_incomplete')&&
  entry.readiness.reasons.every(k=>globalReasons.has(k))&&
  entry.readiness.otherIncomplete===0&&
  entry.counts.partial+entry.counts.unavailable===1&&entry.counts.ambiguous===0&&
  entry.impacts.some(i=>i.id===id&&['partial_fields','unavailable'].includes(i.status));
 for(const month of months)for(const r of month.relations){
  if(!needsRapComponentReview(r))continue;
  if(!pendingByDoc.has(r.from))pendingByDoc.set(r.from,[]);
  pendingByDoc.get(r.from).push({month,r});
 }
 const today=now.toISOString().slice(0,10);
 const protectedSet=new Set(protectedIds);
 const recent=(stamp,days)=>validDay(stamp)&&stamp<=today&&Date.parse(today)-Date.parse(stamp)<days*86400000;
 for(const month of months)for(const doc of month.documents){
  if(!owners.has(doc.id))owners.set(doc.id,[]);
  owners.get(doc.id).push({doc,month});
 }
 for(const [id,entries] of owners){
  if(entries.length!==1)continue;
  const {doc,month}=entries[0];
  if(![2,3].includes(doc.phase))continue;
  const kind=doc.phase===2?'liquidation':'payment';
  if(recentImpactAttempt(month,id,kind,state,now))continue;
  const pending=(pendingByDoc.get(id)||[]).filter(x=>x.month===month).map(x=>x.r);
  if(!pending.length)continue;
  const missing=pending.filter(r=>!r.impactComponents);
  // O checkpoint legado não confirma a coleta de novos campos. Para
  // evidência parcial já consultada, respeitar o prazo normal de revisão.
  if(!missing.length&&recent(state[detailKey(month,id,kind)],30))continue;
  const targets=[...new Set(pending.map(r=>r.to))].map(ne=>trajectories.get(ne));
  const explicit=targets.filter(e=>e?.explicitRapEvidence&&e.originStatus==='collected').length;
  const closing=targets.filter(e=>finalGap(e,id)).length;
  candidates.push({id,month:month.month,kind,recheck:doc.phase===2?
   doc.liquidationLinksChecked===true:doc.paymentLinksChecked===true,
   rapRecovery:true,missing:missing.length,pending:pending.length,explicit,closing,
   origin2025:pending.some(r=>r.to.slice(11,15)==='2025')});
 }
 const queue=[...base],selected=[];
 const clean=({missing,pending,origin2025,explicit,closing,...task})=>task;
 // Rodízio estratificado: priorizar o primeiro preenchimento, com uma
 // vaga para origem 2025 sempre que houver espaço. Nunca ampliar o lote.
 for(const kind of ['liquidation','payment']){
  const slots=queue.filter(t=>t.kind===kind&&!protectedSet.has(t.id)).length;
  const quota=Math.min(slots,Math.max(1,Math.floor(slots*.20)));
  if(!quota)continue;
  const pool=candidates.filter(t=>t.kind===kind&&!protectedSet.has(t.id));
  const ordered=pool.sort((a,b)=>Number(b.missing>0)-Number(a.missing>0)||
   b.missing-a.missing||b.pending-a.pending||a.id.localeCompare(b.id));
  const first=ordered.filter(x=>x.missing>0),partial=ordered.filter(x=>!x.missing);
  const rotating=xs=>{if(!xs.length)return [];const offset=slot%xs.length;return xs.slice(offset).concat(xs.slice(0,offset));};
  const preferred=[...rotating(first),...rotating(partial)];
  const reserve=quota>=2?preferred.find(x=>x.origin2025&&x.missing):null;
  // Até metade da reserva RAP é dirigida por evidência, sem aumentar o lote.
  // Em reserva unitária alternar rodada dirigida e exploração. Preservar a
  // vaga de 2025 e o rodízio geral para não abandonar referências sem inscrição.
  const chosen=reserve?[reserve]:[];
  const guidedLimit=quota===1?(slot%2===0?1:0):Math.floor(quota/2);
  const guided=pool.filter(t=>t.explicit>0&&t.missing>0).sort((a,b)=>
    b.closing-a.closing||b.explicit-a.explicit||b.missing-a.missing||a.id.localeCompare(b.id));
  // Rotacionar somente dentro da mesma prioridade, não diluir a classificação.
  const tiers=new Map();
  for(const t of guided){
   const key=[t.closing,t.explicit,t.missing].join('/');
   if(!tiers.has(key))tiers.set(key,[]);
   tiers.get(key).push(t);
  }
  const directed=[...tiers.values()].flatMap(rotating);
  for(const t of directed){
   if(chosen.length>=quota||chosen.filter(x=>x.explicit>0&&x.missing>0).length>=guidedLimit)break;
   if(!chosen.some(x=>x.id===t.id))chosen.push(t);
  }
  for(const t of preferred){
   if(chosen.length>=quota)break;
   if(!chosen.some(x=>x.id===t.id))chosen.push(t);
  }
  for(const t of chosen){
   let index=queue.findIndex(x=>x.kind===kind&&x.id===t.id);
   if(index<0)index=queue.findLastIndex(x=>x.kind===kind&&!protectedSet.has(x.id)&&!chosen.some(y=>y.id===x.id));
   if(index<0)continue;
   queue.splice(index,1);selected.push(t);
  }
 }
 const tasks=roundRobin(['items','itemHistory','payment','liquidation'].map(k=>
  [...selected.map(clean),...queue].filter(t=>t.kind===k)),base.length);
 return {tasks,summary:{eligibleDocuments:candidates.length,eligiblePairs:candidates.reduce((n,t)=>n+t.pending,0),
  selectedDocuments:selected.length,selectedPairs:selected.reduce((n,t)=>n+t.pending,0),
  selectedWithoutComponents:selected.reduce((n,t)=>n+t.missing,0),
  selectedOrigin2025:selected.filter(t=>t.origin2025).length,
  eligibleWithExplicitEvidence:candidates.filter(t=>t.explicit>0).length,
  selectedWithExplicitEvidence:selected.filter(t=>t.explicit>0).length,
  selectedPotentialLastImpactGap:selected.reduce((n,t)=>n+t.closing,0),
  readiness,
  byKind:Object.fromEntries(['liquidation','payment'].map(k=>[k,selected.filter(t=>t.kind===k).length]))}};
}
/** Uma reconsulta especificamente voltada a componentes não deve retificar
 * os valores legados ou suprimir relações já confirmadas automaticamente. */
export function consistentRapRecovery(previous,incoming){
 return previous.every(old=>incoming.some(next=>next.to===old.to&&next.from===old.from&&next.cents===old.cents&&
  (!old.impactComponents||Object.keys(IMPACT_FIELDS).every(k=>old.impactComponents[k]===null||
   old.impactComponents[k]===next.impactComponents?.[k]))));
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
      'acesso_negado','recurso_nao_encontrado','erro_http','impacto_rap_divergente'].includes(reason)
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
  const slot=Math.floor(Date.now()/14400000);
  const statePath=process.env.CGU_HISTORY_STATE_PATH;
  const historyState=await readOperationalState(statePath);
  const now=new Date();
  const args={slot,historyState,now,
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
  const today=currentDateInBrazil(now);
  const beforeChronology=buildCommitmentChronology(months,{today});
  const beforeCatalogs=summarizeCatalogBacklog(months);
  const beforeRap=summarizeRapEvidence(months);
  console.log('Evidencia RAP antes da rodada (somente contagens): '+JSON.stringify(beforeRap));
  const beforeHistories=summarizeHistoryBacklog(months),beforeValues=summarizeCommitmentValues(months,{today});
  console.log('Cobertura de historicos de itens antes da rodada (somente contagens): '+JSON.stringify(beforeHistories));
  console.log('Cobertura de catalogos NE antes da rodada (somente contagens): '+JSON.stringify(beforeCatalogs));
  const records=new Map(indexCommitmentChronology(months).entries.map(r=>[r.id,r]));
  const cguContracts=(await readCguContractEvidence(root)).contracts;
  const beforeContracts=summarizeContractProgress(months,cguContracts);
  const beforeDivergences=summarizeCatalogDivergences(months,cguContracts);
  console.log('Divergencias de catalogo antes da rodada (somente contagens): '+JSON.stringify(beforeDivergences));
  console.log('Cobertura contratual antes da rodada: '+JSON.stringify(beforeContracts));
  const impactPlan=prioritizeRelatedImpacts(planEnrichmentAcrossMonths(months,args,{review:Boolean(statePath)}),months,{slot,state:historyState,now,cguContracts});
  const rapPlan=statePath?prioritizeRapComponentRecovery(impactPlan.tasks,months,{
    state:historyState,now,slot,protectedIds:impactPlan.protectedIds,totalMonths:manifest.months.length
  }):{tasks:impactPlan.tasks,summary:null};
  const base=rapPlan.tasks;
  console.log('Plano de recuperação de componentes RAP (somente contagens): '+JSON.stringify(rapPlan.summary));
  console.log('Impactos priorizados por relação CGU: '+JSON.stringify({selected:impactPlan.selected,contractPriority:impactPlan.contractPriority,paymentPriority:impactPlan.paymentPriority,contractPendingDocuments:impactPlan.contractPendingDocuments,contractPendingPaymentPairs:impactPlan.contractPendingPaymentPairs}));
  const {tasks,summary:chronologyPlan}=planChronologyEnrichment(base,months,{
    slot,state:historyState,now,review:Boolean(statePath),maxItems:args.maxItems,
    maxItemHistories:args.maxItemHistories,maxHistoryRechecks:args.maxHistoryRechecks,cguContracts
  });
  console.log('Plano de conciliacao NE (somente contagens): '+JSON.stringify({
    identities:beforeChronology.identities,beforeCutoffIdentities:beforeChronology.beforeCutoffIdentities,reconciled:beforeChronology.reconciled,
    pending:beforeChronology.pending,pendingReasons:beforeChronology.pendingReasons,...chronologyPlan
  }));
  const probePlan=planDivergenceProbes(months,{cguContracts,state:historyState,now,today,slot,
    excludeIds:tasks.filter(t=>['items','itemHistory'].includes(t.kind)).map(t=>t.id)});
  console.log('Plano de sondagem de divergencias (somente contagens): '+JSON.stringify(probePlan.summary));
  console.log('Semantica de valores NE (somente contagens): '+JSON.stringify(summarizeStoredValueMeanings(months,{today})));
  if(!tasks.length&&!probePlan.selected.length){
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
  const limits=collectionLimits({intensive:process.env.ENRICH_INTENSIVE==='true',backlog:tasks.length,threshold:50});
  const budget=createCguBudget(limits);
  const probeReport=await runDivergenceProbes(probePlan,{token,parent:budget,limits,state:historyState,now,today,slot});
  console.log('Sondagem CGU de divergencias (somente contagens): '+JSON.stringify(probeReport));
  let successes=0,errors=0,links=0,items=0,attempted=0,completedReviews=0,followupsPromoted=0;
  const failures=[],phaseResults={},catalogRecovery={attempted:0,recovered:0,empty:0,failed:0,paginationExtended:0,byYear:{}};
  const historyRecovery={attempted:0,completed:0,newlyChecked:0,empty:0,failed:0,paginationExtended:0,byYear:{}};
  for(let taskIndex=0;taskIndex<tasks.length;taskIndex++){
    const task=tasks[taskIndex];
    if(budget.stopped())break;
    const {kind,id,month,seq,recheck,rapRecovery}=task;
    const before=await readMonth(root,month);
    const doc=before.documents.find(d=>d.id===id);
    const old=kind==='itemHistory'?before.itemsByDocument?.[id]?.find(x=>x.seq===seq):null;
    if(!doc||kind==='itemHistory'&&!old)continue;
    const record=records.get(id);
    const currentRecord=record?.owners.length===1?{...record,owners:[{doc,month,items:before.itemsByDocument?.[id]}]}:record;
    const attemptKey=chronologyAttemptKey(currentRecord,task);
    const initialCatalog=kind==='items'&&needsInitialCatalog(currentRecord);
    const pageLimit=kind==='items'?catalogPageLimit(currentRecord,historyState,new Date()):
      kind==='itemHistory'?historyPageLimit(currentRecord,task,historyState,new Date()):8;
    const catalogYear=initialCatalog?(catalogRecovery.byYear[id.slice(11,15)]||={attempted:0,recovered:0,empty:0,failed:0}):null;
    if(initialCatalog){catalogRecovery.attempted++;catalogYear.attempted++;if(pageLimit>8)catalogRecovery.paginationExtended++;}
    const historyYear=kind==='itemHistory'?(historyRecovery.byYear[id.slice(11,15)]||={attempted:0,completed:0,newlyChecked:0,empty:0,failed:0}):null;
    if(historyYear){historyRecovery.attempted++;historyYear.attempted++;if(pageLimit>8)historyRecovery.paginationExtended++;}
    attempted++;
    const phase=phaseResults[kind]||=( {attempted:0,successes:0,errors:0} );phase.attempted++;
    const outcome=kind==='liquidation'?await resolveLiquidationLinks(id,{token,budget,includeRapComponents:true}):
      kind==='payment'?await resolvePaymentLinks(id,{token,budget,includeRapComponents:true}):
      kind==='items'?await resolveItems(id,{token,budget,limit:pageLimit}):await resolveItemMovements(id,seq,{token,budget,limit:pageLimit});
    if(attemptKey&&(outcome.ok||!budget.stopped()))historyState[attemptKey]=new Date().toISOString().slice(0,10);
    if(!outcome.ok){
      if(historyYear){
        historyRecovery.failed++;historyYear.failed++;
        const k=historyPaginationKey(currentRecord,task);
        if(k&&outcome.reason==='limite_paginacao'&&!budget.stopped())historyState[k]=new Date().toISOString().slice(0,10);
      }
      if(initialCatalog){
        catalogRecovery.failed++;catalogYear.failed++;
        const k=catalogPaginationKey(currentRecord);
        if(k&&outcome.reason==='limite_paginacao'&&!budget.stopped())historyState[k]=new Date().toISOString().slice(0,10);
      }
      if(statePath&&!budget.stopped()&&['payment','liquidation'].includes(kind))historyState[impactAttemptKey(before,id,kind)]=new Date().toISOString().slice(0,10);
      failures.push(outcome.reason||'outro');errors++;phase.errors++;continue;
    }
    if(rapRecovery&&!consistentRapRecovery(before.relations.filter(r=>r.from===id),outcome.links)){
      if(statePath)historyState[impactAttemptKey(before,id,kind)]=new Date().toISOString().slice(0,10);
      failures.push('impacto_rap_divergente');errors++;phase.errors++;continue;
    }
    const result=kind==='items'?{kind,items:outcome.items,recheck}:
      kind==='itemHistory'?{kind,seq,movements:outcome.movements,checkedAt:new Date().toISOString().slice(0,10)}:
        {kind,links:outcome.links};
    try{
      if(statePath&&kind==='itemHistory'&&old.historyChecked===true&&JSON.stringify(old.movements)===JSON.stringify(result.movements)&&
        !requiresCanonicalHistoryCheckpoint(currentRecord,old))
        delete result.checkedAt;
      if(kind==='liquidation'&&doc.cents===null&&outcome.links.length&&before.coverage.some(c=>c.date===doc.date&&c.phase===2&&c.complete)){
        const total=outcome.links.reduce((n,l)=>n+BigInt(l.cents),0n);
        if(total<=BigInt(Number.MAX_SAFE_INTEGER)&&total>=BigInt(Number.MIN_SAFE_INTEGER)){
          result.kind='liquidationValue';result.cents=Number(total);
        }
      }
      const changed=await persistEnrichment(root,month,id,result,new Date());
      if(changed)phase.changed=(phase.changed||0)+1;
      const after=await readMonth(root,month);
      const updated=after.documents.find(d=>d.id===id);
      if(currentRecord?.owners.length===1){
        const nextRecord={...currentRecord,owners:[{doc:updated,month,items:after.itemsByDocument?.[id]}]};
        records.set(id,nextRecord);
        if(attemptKey){
          const nextKey=chronologyAttemptKey(nextRecord,task);
          if(nextKey)historyState[nextKey]=new Date().toISOString().slice(0,10);
        }
        if(kind==='items'&&!budget.stopped()&&followupsPromoted<6)
          followupsPromoted+=promoteCatalogHistories(tasks,taskIndex,nextRecord,{
            remaining:6-followupsPromoted,state:historyState,now:new Date()
          });
      }
      if(statePath){
        const previousKey=kind==='itemHistory'?historyKey(doc,old):detailKey(before,id,kind);
        const currentKey=kind==='itemHistory'?historyKey(updated,after.itemsByDocument[id].find(x=>x.seq===seq)):detailKey(after,id,kind);
        delete historyState[previousKey];
        historyState[currentKey]=new Date().toISOString().slice(0,10);
      }
    }catch{
      if(historyYear){historyRecovery.failed++;historyYear.failed++;}
      if(initialCatalog){catalogRecovery.failed++;catalogYear.failed++;}
      if(statePath&&!budget.stopped()&&['payment','liquidation'].includes(kind))historyState[impactAttemptKey(before,id,kind)]=new Date().toISOString().slice(0,10);
      failures.push('persistencia_invalida');errors++;phase.errors++;continue;
    }
    if(historyYear){
      historyRecovery.completed++;historyYear.completed++;
      if(!outcome.movements.length){historyRecovery.empty++;historyYear.empty++;}
      if(old.historyChecked!==true){historyRecovery.newlyChecked++;historyYear.newlyChecked++;}
      const k=historyPaginationKey(currentRecord,task);if(k)delete historyState[k];
    }
    if(initialCatalog){
      const key=outcome.items.length?'recovered':'empty';
      catalogRecovery[key]++;catalogYear[key]++;
      const k=catalogPaginationKey(currentRecord);if(k)delete historyState[k];
    }
    successes++;phase.successes++;if(recheck)completedReviews++;
    links+=outcome.links?.length||0;items+=outcome.items?.length||0;
  }
  const snapshot=budget.snapshot();
  console.log('Telemetria enriquecimento CGU: '+JSON.stringify({planned:tasks.length,attempted,successes,errors,completedReviews,followupsPromoted,phaseResults,limits,...snapshot}));
  console.log('Avaliacao de capacidade CGU: '+JSON.stringify(assessCollectionCapacity({attempted,successes,changed:Object.values(phaseResults).reduce((n,p)=>n+(p.changed||0),0),limits,snapshot})));
  const validated=await validatePublishedData(root);
  const comparedMonths=selected?validated.months.filter(m=>m.month===selected):validated.months;
  const afterChronology=buildCommitmentChronology(comparedMonths,{today});
  const afterCatalogs=summarizeCatalogBacklog(comparedMonths);
  console.log('Evidencia RAP depois da rodada (somente contagens): '+JSON.stringify(summarizeRapEvidence(comparedMonths)));
  const afterHistories=summarizeHistoryBacklog(comparedMonths),afterValues=summarizeCommitmentValues(comparedMonths,{today});
  console.log('Resultado da recuperacao de historicos de itens (somente contagens): '+JSON.stringify({before:beforeHistories,after:afterHistories,reconstruction:{before:beforeValues.internal,after:afterValues.internal,documentDifferentBefore:beforeValues.documentDifferent,documentDifferentAfter:afterValues.documentDifferent},...historyRecovery}));
  console.log('Resultado da recuperacao de catalogos NE (somente contagens): '+JSON.stringify({before:beforeCatalogs,after:afterCatalogs,deltaMissing:afterCatalogs.missing-beforeCatalogs.missing,...catalogRecovery}));
  const afterContracts=summarizeContractProgress(comparedMonths,cguContracts);
  const afterDivergences=summarizeCatalogDivergences(comparedMonths,cguContracts);
  console.log('Divergencias de catalogo depois da rodada (somente contagens): '+JSON.stringify({before:beforeDivergences,after:afterDivergences,delta:afterDivergences.total-beforeDivergences.total}));
  console.log('Resultado de cobertura contratual (somente contagens): '+JSON.stringify({before:beforeContracts,after:afterContracts,delta:Object.fromEntries(Object.keys(afterContracts).map(k=>[k,afterContracts[k]-beforeContracts[k]]))}));
  console.log('Resultado de conciliacao NE (somente contagens): '+JSON.stringify({
    before:beforeChronology.reconciled,after:afterChronology.reconciled,
    netChange:afterChronology.reconciled-beforeChronology.reconciled,
    identities:afterChronology.identities,pending:afterChronology.pending,
    pendingReasons:afterChronology.pendingReasons,followupsPromoted
  }));
  await saveOperationalState(statePath,historyState);
  console.log('Motivos de consultas não concluídas (somente contagens, sem IDs ou respostas): '+
    JSON.stringify(summarizeFailures(failures)));
  console.log('Enriquecimento CGU (liquidações, pagamentos e itens): '+successes+' documento(s) concluído(s), '+
    errors+' sem conclusão; '+links+' vínculo(s) de liquidação/pagamento e '+
    items+' item(ns) de empenho. Historicos de itens sao processados separadamente. '+
    'Respostas brutas e dados pessoais não persistidos.');
  if(!successes&&(errors||['http_401','http_403','http_429','source_unstable'].includes(probeReport.parentStopped)))throw Error('Não foi possível completar nenhuma consulta regular; verificar disponibilidade da CGU');
}
if(process.argv[1] && import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  main().catch(()=>{
    console.error('Enriquecimento não concluído; checkpoints anteriores permanecem preservados.');
    process.exitCode=1;
  });
}

/** Planejamento de consultas CGU por NE, sem flexibilizar a conciliacao.
 * Usa somente o acervo validado e o cache operacional descartavel.
 * Nenhum ID ou retorno bruto aparece na telemetria. */
import {indexCommitmentChronology,commitmentChronologyEvidence,reconcileSiafiItem} from '../assets/siafi-movement-reconciliation.js';
import {stateKey,validDay} from './operational-state.mjs';

const DAY=86400000;
const MAX_GROUP=6,MAX_FOLLOWUP=2,MAX_REPAIRS=2;
const isNeTask=t=>t.kind==='items'||t.kind==='itemHistory';
const key=t=>[t.kind,t.id,t.seq||0].join('/');
const rotate=(rows,slot)=>rows.length?rows.slice(slot%rows.length).concat(rows.slice(0,slot%rows.length)):[];
const todayOf=now=>now.toISOString().slice(0,10);
function latestReference(doc,observations){
 return [{date:doc.date,cents:doc.cents},...observations]
  .sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
}
function safeSum(items){
 if(!Array.isArray(items)||items.some(i=>!Number.isSafeInteger(i.cents)))return null;
 const sum=items.reduce((n,i)=>n+BigInt(i.cents),0n);
 return sum<=BigInt(Number.MAX_SAFE_INTEGER)&&sum>=BigInt(Number.MIN_SAFE_INTEGER)?Number(sum):null;
}
function currentTask(kind,record,item){
 const {doc,month,items}=record.owners[0];
 return kind==='items'?{kind,month,id:doc.id,recheck:Array.isArray(items)}:
   {kind,month,id:doc.id,seq:item.seq,recheck:item.historyChecked===true};
}
/** Hash depende da evidencia, nao da data de gravacao nem de IDs publicados no cache. */
export function chronologyAttemptKey(record,task){
 if(!record||record.owners.length!==1||!isNeTask(task))return null;
 const {doc,items}=record.owners[0],reference=latestReference(doc,record.observations);
 const evidence=task.kind==='items'?(items||[]).map(i=>[i.seq,i.cents]):
   (items||[]).filter(i=>i.seq===task.seq).map(i=>[i.seq,i.cents,i.historyChecked===true,i.movements||[]]);
 return stateKey(['chronology-attempt-v1',task.kind,doc.id,doc.date,doc.cents,doc.itemsDetailVersion,
   reference.date,reference.cents,task.seq||0,evidence]);
}
function recentlyAttempted(record,task,state,now,days){
 const k=chronologyAttemptKey(record,task),last=k&&state[k];
 return validDay(last)&&Date.parse(todayOf(now)+'T00:00:00Z')-Date.parse(last+'T00:00:00Z')<days*DAY;
}
export function requiresCanonicalHistoryCheckpoint(record,item){
 if(!record||record.owners.length!==1||!record.observations.length)return false;
 const reference=latestReference(record.owners[0].doc,record.observations);
 return !validDay(item.historyCheckedAt)||item.historyCheckedAt<reference.date;
}
/** Uma NE pode ser completada em uma rodada apenas se catalogo e valor de
 * referencia coincidirem e todos os historicos restantes couberem no grupo.
 * Historicos ja consultados mas nao conciliaveis vao para revisao rotativa. */
export function classifyChronologyWork(record,{state={},now=new Date()}={}){
 if(!record||record.owners.length!==1)return {kind:'blocked',reason:'duplicate_identity'};
 const {doc,items}=record.owners[0];
 const observations=record.observations,reference=latestReference(doc,observations);
 const evidence=commitmentChronologyEvidence(doc,items,observations);
 if(evidence.status==='reconciled')return {kind:'done'};
 if(!Number.isSafeInteger(reference.cents))return {kind:'blocked',reason:'reference_amount_pending'};
 const catalogNeeded=doc.itemsDetailVersion!==2||!Array.isArray(items)||!items.length||safeSum(items)!==reference.cents;
 if(catalogNeeded){
   const task=currentTask('items',record),days=task.recheck?7:1;
   if(recentlyAttempted(record,task,state,now,days))return {kind:'cooldown'};
   return {kind:'catalog',task,observed:observations.length>0,recheck:task.recheck};
 }
 const missing=[],repairs=[];
 let deferred=false;
 for(const item of items){
   const task=currentTask('itemHistory',record,item);
   if(item.historyChecked!==true||requiresCanonicalHistoryCheckpoint(record,item)){
     if(recentlyAttempted(record,task,state,now,1))deferred=true;
     else missing.push(task);
   }else if(reconcileSiafiItem(item,{commitmentYear:doc.id.slice(11,15)}).status!=='reconciled'){
     if(!recentlyAttempted(record,task,state,now,7))repairs.push(task);
     else deferred=true;
   }
 }
 if(repairs.length)return {kind:'repair',tasks:repairs,observed:observations.length>0};
 if(deferred)return {kind:'cooldown'};
 if(missing.length)return {kind:'history',tasks:missing,observed:observations.length>0};
 return {kind:'blocked',reason:evidence.reason};
}
function orderGroups(groups,slot){
 // Custo baixo primeiro, rodizio dentro do mesmo custo e entre exercicios.
 const costs=[...new Set(groups.map(g=>g.tasks.length))].sort((a,b)=>a-b),result=[];
 for(const cost of costs){
   const same=groups.filter(g=>g.tasks.length===cost);
   const years=[...new Set(same.map(g=>g.year))].sort();
   const queues=rotate(years,slot).map(year=>rotate(same.filter(g=>g.year===year)
     .sort((a,b)=>a.id.localeCompare(b.id)),slot));
   while(queues.some(q=>q.length))for(const q of queues)if(q.length)result.push(q.shift());
 }
 return result;
}
function unique(rows){
 const seen=new Set();return rows.filter(t=>{const k=key(t);if(seen.has(k))return false;seen.add(k);return true});
}
function interleave(queues){
 const result=[];
 while(queues.some(q=>q.length))for(const q of queues)if(q.length)result.push(q.shift());
 return result;
}
const priorityTask=(t,tag)=>({...t,chronologyPriority:tag});

/** Reserva ate 60% dos historicos para grupos pequenos completos, mas conserva
 * rodizio normal e todas as vagas planejadas para NS e pagamentos.
 * Reconsultas de casos sem conciliacao ficam limitadas a duas por tipo.
 * Os tetos de tarefas e o orcamento HTTP existente continuam soberanos. */
export function planChronologyEnrichment(base,months,{
 slot=0,state={},now=new Date(),maxItems=7,maxItemHistories=10,maxHistoryRechecks=2,review=false
}={}){
 maxItems=Number(maxItems);maxItemHistories=Number(maxItemHistories);maxHistoryRechecks=Number(maxHistoryRechecks);
 if(!Number.isSafeInteger(slot)||slot<0||
    !Number.isSafeInteger(maxItems)||maxItems<1||maxItems>20||
    !Number.isSafeInteger(maxItemHistories)||maxItemHistories<1||maxItemHistories>30||
    !Number.isSafeInteger(maxHistoryRechecks)||maxHistoryRechecks<1||maxHistoryRechecks>8)
   throw Error('Cotas de conciliacao invalidas');
 const records=indexCommitmentChronology(months).entries,byId=new Map(records.map(r=>[r.id,r]));
 const catalogs=[],groups=[],repairs=[];
 for(const record of records){
   const work=classifyChronologyWork(record,{state,now});
   const tagged={...work,id:record.id,year:record.id.slice(11,15)};
   if(work.kind==='catalog')catalogs.push(tagged);
   else if(work.kind==='history'&&work.tasks.length<=MAX_GROUP)groups.push(tagged);
   else if(work.kind==='repair')repairs.push(tagged);
 }
 const orderCatalog=rows=>rotate(rows.sort((a,b)=>a.id.localeCompare(b.id)),slot);
 const catalogQuota=Math.max(1,Math.floor(maxItems*0.4));
 const reviewCatalogs=orderCatalog(catalogs.filter(x=>x.recheck&&x.observed))
   .concat(orderCatalog(catalogs.filter(x=>x.recheck&&!x.observed)));
 const newCatalogs=orderCatalog(catalogs.filter(x=>!x.recheck&&x.observed))
   .concat(orderCatalog(catalogs.filter(x=>!x.recheck&&!x.observed)));
 const chosenCatalogs=[...reviewCatalogs.slice(0,Math.min(MAX_REPAIRS,catalogQuota)),
   ...newCatalogs].slice(0,catalogQuota);
 const priorityItems=chosenCatalogs.map(x=>priorityTask(x.task,x.recheck?'catalog_review':'catalog_pending'));
 const catalogIds=new Set(priorityItems.map(t=>t.id));
 const historyQuota=Math.max(1,Math.floor(maxItemHistories*0.6));
 const ordered=orderGroups(groups.filter(g=>g.observed),slot).concat(orderGroups(groups.filter(g=>!g.observed),slot));
 const priorityHistory=[];
 let groupsSelected=0;
 for(const group of ordered){
   if(catalogIds.has(group.id)||group.tasks.length>historyQuota-priorityHistory.length)continue;
   priorityHistory.push(...group.tasks.map(t=>priorityTask(t,'finish_group')));groupsSelected++;
 }
 const groupTasks=priorityHistory.length;
 const repairLimit=Math.min(MAX_REPAIRS,maxHistoryRechecks,maxItemHistories-groupTasks);
 const repairTasks=orderGroups(repairs,slot).flatMap(g=>g.tasks.slice(0,1)).slice(0,repairLimit);
 priorityHistory.push(...repairTasks.map(t=>priorityTask(t,'history_review')));
 const eligible=t=>{
   const record=byId.get(t.id);
   if(record?.owners.length!==1)return false;
   const item=t.kind==='itemHistory'?record.owners[0].items?.find(i=>i.seq===t.seq):null;
   const freshRequired=item&&requiresCanonicalHistoryCheckpoint(record,item);
   return !recentlyAttempted(record,t,state,now,t.recheck&&!freshRequired?7:1);
 };
 const baseItems=base.filter(t=>t.kind==='items');
 const baseHistory=base.filter(t=>t.kind==='itemHistory');
 // Nao perder vagas de outras fases; usar vagas livres apenas dentro das
 // mesmas cotas de itens/historicos (mais as duas revisoes ja existentes).
 const itemLimit=Math.min(maxItems+(review?2:0),Math.max(baseItems.length,priorityItems.length));
 const historyLimit=Math.min(maxItemHistories+maxHistoryRechecks,Math.max(baseHistory.length,priorityHistory.length));
 const items=unique([...priorityItems,...baseItems.filter(eligible)]).slice(0,itemLimit);
 const histories=unique([...priorityHistory,...baseHistory.filter(t=>eligible(t)&&!catalogIds.has(t.id))]).slice(0,historyLimit);
 const other=base.filter(t=>!isNeTask(t));
 const tasks=interleave([items,histories,other.filter(t=>t.kind==='liquidation'),other.filter(t=>t.kind==='payment'),
   other.filter(t=>!['liquidation','payment'].includes(t.kind))]);
 return {tasks,summary:{groupsSelected,groupTasks,catalogTasks:priorityItems.length,repairTasks:repairTasks.length,
   eligibleSmallGroups:groups.length,eligibleCatalogs:catalogs.length,eligibleHistoryReviews:repairs.length}};
}

/** Apos concluir um catalogo pequeno, recuperar seus historicos na mesma
 * rodada, substituindo apenas vagas ainda nao tentadas e sem aumentar o lote.
 * Nao desaloca grupos de fechamento nem tarefas de NS/OB. */
export function promoteCatalogHistories(tasks,index,record,{remaining=6,state={},now=new Date()}={}){
 const work=classifyChronologyWork(record,{state,now});
 if(work.kind!=='history'||work.tasks.length>MAX_FOLLOWUP||work.tasks.length>remaining)return 0;
 const done=new Set(tasks.slice(0,index+1).map(key));
 if(work.tasks.some(t=>done.has(key(t))))return 0;
 const needed=work.tasks.map(key),remove=[];
 for(let i=index+1;i<tasks.length;i++)if(needed.includes(key(tasks[i]))){
   if(tasks[i].chronologyPriority)return 0;
   remove.push(i);
 }
 for(let i=tasks.length-1;i>index&&remove.length<needed.length;i--){
   const t=tasks[i];
   if(t.kind==='itemHistory'&&!t.chronologyPriority&&!remove.includes(i))remove.push(i);
 }
 if(remove.length!==needed.length)return 0;
 for(const i of remove.sort((a,b)=>b-a))tasks.splice(i,1);
 tasks.splice(index+1,0,...work.tasks.map(t=>priorityTask(t,'catalog_followup')));
 return needed.length;
}

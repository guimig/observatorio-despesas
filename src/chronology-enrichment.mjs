/** Planejamento de consultas CGU por NE, sem flexibilizar a conciliacao.
 * Usa somente o acervo validado e o cache operacional descartavel.
 * Nenhum ID ou retorno bruto aparece na telemetria. */
import {indexCommitmentChronology,commitmentChronologyEvidence,reconcileSiafiItem} from '../assets/siafi-movement-reconciliation.js';
import {stateKey,validDay} from './operational-state.mjs';

const DAY=86400000;
const MAX_GROUP=6,MAX_FOLLOWUP=4,MAX_REPAIRS=2;
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
/** Diagnostico exclusivamente agregado: igualdade com observacao anterior nao
 * autoriza alterar o valor documental mais recente nem confirmar movimentos. */
export function summarizeCatalogDivergences(months,cguContracts=[]){
 const contracts=new Set(cguContracts.flatMap(c=>c.refs||[]));
 const result={total:0,contractual:0,byYear:{},reasons:{},history:{complete:0,partial:0,none:0},direction:{above:0,below:0}};
 for(const record of indexCommitmentChronology(months).entries){
  if(record.owners.length!==1)continue;
  const {doc,items}=record.owners[0];
  if(commitmentChronologyEvidence(doc,items,record.observations).reason!=='catalog_amount_mismatch')continue;
  const latest=latestReference(doc,record.observations),sum=safeSum(items);
  const refs=[{date:doc.date,cents:doc.cents},...record.observations];
  const previousMatch=refs.some(r=>r.date<latest.date&&r.cents===sum);
  const reason=previousMatch?'matches_earlier_listing':refs.length>1?'different_from_all_observations':'single_listing_mismatch';
  result.total++;if(contracts.has(record.id))result.contractual++;
  const year=record.id.slice(11,15);result.byYear[year]=(result.byYear[year]||0)+1;
  result.reasons[reason]=(result.reasons[reason]||0)+1;
  const checked=items.filter(i=>i.historyChecked===true).length;
  result.history[checked===items.length?'complete':checked?'partial':'none']++;
  if(sum!==null)result.direction[sum>latest.cents?'above':'below']++;
 }
 return result;
}
/** Catalogo de primeira recuperacao ou de normalizacao legada; vazio v2
 * e uma consulta ja realizada, nao uma NE nova. */
export function needsInitialCatalog(record){
 if(record?.owners?.length!==1)return false;
 const {doc,items}=record.owners[0];
 return doc.itemsDetailVersion!==2||!Array.isArray(items);
}
/** So planejar historicos para sequenciais e valores validos. A coincidencia
 * com o valor documental nao e requisito da recuperacao independente. */
function hasValidHistoryCatalog(record){
 if(record?.owners?.length!==1||needsInitialCatalog(record))return false;
 const {items}=record.owners[0];
 return items.length>0&&items.every(i=>Number.isSafeInteger(i.seq)&&i.seq>0&&Number.isSafeInteger(i.cents)&&i.cents>=0)&&
  new Set(items.map(i=>i.seq)).size===items.length&&safeSum(items)!==null;
}
function historyRequirements(record){
 const {doc,items}=record.owners[0],year=doc.id.slice(11,15);
 return items.map(item=>({item,kind:item.historyChecked!==true?'unchecked':
  requiresCanonicalHistoryCheckpoint(record,item)?'stale':
  reconcileSiafiItem(item,{commitmentYear:year}).status!=='reconciled'?'repair':null}));
}
function needsIndependentHistory(record){
 const {doc,items}=record.owners[0],reference=latestReference(doc,record.observations);
 return !Number.isSafeInteger(reference.cents)||safeSum(items)!==reference.cents;
}
/** Contagens da fila real de historicos, sem valores ou IDs. Nao equivale
 * ao numero de NEs conciliadas: a regra financeira permanece independente. */
export function summarizeHistoryBacklog(months){
 const empty=()=>({validCatalogs:0,notesWithWork:0,independentNotesWithWork:0,uncheckedItems:0,staleItems:0,repairItems:0});
 const result={...empty(),byYear:{}};
 for(const record of indexCommitmentChronology(months).entries){
  if(!hasValidHistoryCatalog(record))continue;
  const y=result.byYear[record.id.slice(11,15)]||=empty();
  const work=historyRequirements(record).filter(row=>row.kind);
  for(const bucket of [result,y]){
   bucket.validCatalogs++;
   if(work.length){bucket.notesWithWork++;if(needsIndependentHistory(record))bucket.independentNotesWithWork++;}
   for(const {kind} of work)bucket[kind==='unchecked'?'uncheckedItems':kind==='stale'?'staleItems':'repairItems']++;
  }
 }
 return result;
}
export function summarizeCatalogBacklog(months){
 const rows=indexCommitmentChronology(months).entries,byYear={};
 const result={identities:rows.length,missing:0,empty:0,available:0,duplicate:0,byYear};
 for(const r of rows){
  const year=r.id.slice(11,15),y=byYear[year]||={missing:0,empty:0,available:0,duplicate:0};
  const key=r.owners.length!==1?'duplicate':needsInitialCatalog(r)?'missing':!r.owners[0].items.length?'empty':'available';
  result[key]++;y[key]++;
 }
 return result;
}
/** Uma vaga por exercicio ativo, seguida de alocacao proporcional ao passivo.
 * Tentativas antigas primeiro dentro do exercicio, com rodizio dos empates.
 * A reserva contratual usa as mesmas vagas, sem aumentar o teto. */
export function orderMissingCatalogs(rows,{limit,slot=0,contractual=()=>false}={}){
 if(!Number.isSafeInteger(limit)||limit<0||!Number.isSafeInteger(slot)||slot<0)throw Error('Cota de catalogos invalida');
 const years=rotate([...new Set(rows.map(x=>x.year))].sort(),slot);
 const groups=years.map(year=>{
  const same=rows.filter(x=>x.year===year),ordered=[];
  for(const stamp of [...new Set(same.map(x=>x.lastAttempt||''))].sort())
   ordered.push(...rotate(same.filter(x=>(x.lastAttempt||'')===stamp).sort((a,b)=>a.id.localeCompare(b.id)),slot));
  return {year,queue:ordered,weight:ordered.length,allocated:0};
 });
 const selected=[];
 const take=(g,index=0)=>{if(!g?.queue.length||selected.length>=limit)return;selected.push(g.queue.splice(index,1)[0]);g.allocated++};
 // Uma reserva pequena, sem tomar as vagas minimas de outros exercicios.
 const reserve=Math.min(2,Math.floor(limit/10));
 for(let i=0;i<reserve&&selected.length<Math.max(0,limit-years.length);i++){
  const g=groups.find(x=>x.queue.some(r=>contractual(r.id)));
  if(!g)break;take(g,g.queue.findIndex(r=>contractual(r.id)));
 }
 for(const g of groups)if(!g.allocated)take(g);
 while(selected.length<limit){
  const g=groups.filter(x=>x.queue.length).sort((a,b)=>b.weight/(b.allocated+1)-a.weight/(a.allocated+1))[0];
  if(!g)break;take(g);
 }
 return selected;
}
function currentTask(kind,record,item){
 const {doc,month,items}=record.owners[0];
 return kind==='items'?{kind,month,id:doc.id,recheck:Array.isArray(items)}:
   {kind,month,id:doc.id,seq:item.seq,recheck:item.historyChecked===true};
}
/** Hash depende da evidencia, nao da data de gravacao nem de IDs publicados no cache. */
export function catalogPaginationKey(record){
 if(!record||record.owners.length!==1||!needsInitialCatalog(record))return null;
 return stateKey(['cgu-catalog-pagination-v1',chronologyAttemptKey(record,currentTask('items',record))]);
}
export function catalogPageLimit(record,state={},now=new Date()){
 const k=catalogPaginationKey(record),stamp=k&&state[k];
 return validDay(stamp)&&stamp<=todayOf(now)&&Date.parse(todayOf(now))-Date.parse(stamp)<30*DAY?20:8;
}
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
 return validDay(last)&&last<=todayOf(now)&&Date.parse(todayOf(now)+'T00:00:00Z')-Date.parse(last+'T00:00:00Z')<days*DAY;
}
export function requiresCanonicalHistoryCheckpoint(record,item){
 if(!record||record.owners.length!==1||!record.observations.length)return false;
 const reference=latestReference(record.owners[0].doc,record.observations);
 return !validDay(item.historyCheckedAt)||item.historyCheckedAt<reference.date;
}
/** A recuperacao de historicos pode avancar mesmo sem valor documental
 * comparavel. Somente catalogo valido e identidade unica; nunca altera
 * commitmentChronologyEvidence nem confirma conciliacao documental. */
export function classifyChronologyWork(record,{state={},now=new Date()}={}){
 if(!record||record.owners.length!==1)return {kind:'blocked',reason:'duplicate_identity'};
 const {doc,items}=record.owners[0],observations=record.observations;
 const evidence=commitmentChronologyEvidence(doc,items,observations);
 if(evidence.status==='reconciled')return {kind:'done'};
 const missingCatalog=needsInitialCatalog(record);
 const catalogWork=()=>{
  const task=currentTask('items',record),days=missingCatalog?1:7;
  if(recentlyAttempted(record,task,state,now,days))return {kind:'cooldown'};
  return {kind:'catalog',task,observed:observations.length>0,recheck:task.recheck,missingCatalog,lastAttempt:state[chronologyAttemptKey(record,task)]||''};
 };
 if(!hasValidHistoryCatalog(record))return catalogWork();
 const independent=needsIndependentHistory(record),missing=[],repairs=[];
 let deferredMissing=false,deferredRepair=false;
 const work=historyRequirements(record);
 for(const {item,kind} of work){
  if(!kind)continue;
  const task=currentTask('itemHistory',record,item);
  if(kind==='repair'){
   if(recentlyAttempted(record,task,state,now,7))deferredRepair=true;
   else repairs.push(task);
  }else{
   if(recentlyAttempted(record,task,state,now,1))deferredMissing=true;
   else missing.push(task);
  }
 }
 if(missing.length)return {kind:'history',tasks:missing,observed:observations.length>0,independent,
  canFinish:!deferredMissing&&!deferredRepair&&!repairs.length};
 if(repairs.length)return {kind:'repair',tasks:repairs,observed:observations.length>0,independent};
 if(deferredMissing)return {kind:'cooldown'};
 // Se os historicos ja foram consultados, ainda permite revisar catalogo
 // divergente com o intervalo anterior. Nunca trata ausencia de valor como zero.
 const reference=latestReference(doc,observations);
 if(Number.isSafeInteger(reference.cents)&&safeSum(items)!==reference.cents)return catalogWork();
 if(deferredRepair)return {kind:'cooldown'};
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
 slot=0,state={},now=new Date(),maxItems=7,maxItemHistories=10,maxHistoryRechecks=2,review=false,cguContracts=[]
}={}){
 maxItems=Number(maxItems);maxItemHistories=Number(maxItemHistories);maxHistoryRechecks=Number(maxHistoryRechecks);
 if(!Number.isSafeInteger(slot)||slot<0||
    !Number.isSafeInteger(maxItems)||maxItems<1||maxItems>20||
    !Number.isSafeInteger(maxItemHistories)||maxItemHistories<1||maxItemHistories>30||
    !Number.isSafeInteger(maxHistoryRechecks)||maxHistoryRechecks<1||maxHistoryRechecks>8)
   throw Error('Cotas de conciliacao invalidas');
 const records=indexCommitmentChronology(months).entries,byId=new Map(records.map(r=>[r.id,r]));
 const contractCounts=new Map();
 for(const c of cguContracts)for(const id of new Set(c.refs||[]))contractCounts.set(id,(contractCounts.get(id)||0)+1);
 const contractual=id=>contractCounts.get(id)===1;
 const catalogs=[],groups=[],largeGroups=[],repairs=[],workById=new Map();
 for(const record of records){
   const work=classifyChronologyWork(record,{state,now});workById.set(record.id,work);
   const tagged={...work,id:record.id,year:record.id.slice(11,15)};
   if(work.kind==='catalog')catalogs.push(tagged);
   else if(work.kind==='history')(work.canFinish&&work.tasks.length<=MAX_GROUP?groups:largeGroups).push(tagged);
   else if(work.kind==='repair')repairs.push(tagged);
 }
 const eligible=t=>{
   const record=byId.get(t.id);
   if(record?.owners.length!==1)return false;
   const work=workById.get(t.id);
   if(t.kind==='items'&&['history','repair','cooldown'].includes(work?.kind))return false;
   const item=t.kind==='itemHistory'?record.owners[0].items?.find(i=>i.seq===t.seq):null;
   if(t.kind==='itemHistory'&&(!item||!hasValidHistoryCatalog(record)))return false;
   const freshRequired=item&&requiresCanonicalHistoryCheckpoint(record,item);
   const missing=t.kind==='items'&&needsInitialCatalog(record);
   return !recentlyAttempted(record,t,state,now,t.recheck&&!freshRequired&&!missing?7:1);
 };
 const baseItems=base.filter(t=>t.kind==='items');
 const baseHistory=base.filter(t=>t.kind==='itemHistory');
 const missing=catalogs.filter(x=>x.missingCatalog);
 const initial=orderMissingCatalogs(missing,{limit:maxItems,slot,contractual});
 const initialTasks=initial.map(x=>({...priorityTask(x.task,'catalog_pending'),initialCatalog:true}));
 const reviewCatalogs=rotate(catalogs.filter(x=>!x.missingCatalog).sort((a,b)=>
  Number(b.observed)-Number(a.observed)||a.id.localeCompare(b.id)),slot);
 const reviewSlots=Math.min(MAX_REPAIRS,Math.max(0,maxItems+(review?2:0)-initialTasks.length));
 const reviewTasks=unique([...reviewCatalogs.map(x=>priorityTask(x.task,'catalog_review')),
  ...baseItems.filter(t=>t.recheck&&eligible(t)&&!needsInitialCatalog(byId.get(t.id)))]).slice(0,reviewSlots);
 const priorityItems=[...initialTasks,...reviewTasks];
 const itemLimit=Math.min(maxItems+(review?2:0),Math.max(baseItems.length,priorityItems.length));
 const items=unique([...priorityItems,...baseItems.filter(t=>eligible(t)&&(!needsInitialCatalog(byId.get(t.id))||initial.some(x=>x.id===t.id)))])
  .slice(0,itemLimit);
 const catalogIds=new Set(items.map(t=>t.id));
 const historyQuota=Math.max(1,Math.floor(maxItemHistories*0.6));
 const ordered=orderGroups(groups.filter(g=>g.observed),slot).concat(orderGroups(groups.filter(g=>!g.observed),slot));
 const priorityHistory=[];
 let groupsSelected=0;
 const selectedGroups=new Set();
 const addGroup=(group,limit)=>{
   if(catalogIds.has(group.id)||selectedGroups.has(group.id)||group.tasks.length>limit-priorityHistory.length)return;
   priorityHistory.push(...group.tasks.map(t=>priorityTask(t,'finish_group')));groupsSelected++;selectedGroups.add(group.id);
 };
 // Reserva pequena para contratos univocos; o restante segue rodizio geral.
 const contractHistoryQuota=Math.max(1,Math.floor(historyQuota/3));
 for(const group of ordered.filter(g=>contractual(g.id)))addGroup(group,contractHistoryQuota);
 // Reservar parte dos grupos para NEs que podem ganhar reconstrucao interna
 // mesmo quando a conferencia documental permanece pendente.
 const independentQuota=Math.min(historyQuota,priorityHistory.length+Math.max(1,Math.floor(historyQuota/3)));
 for(const group of ordered.filter(g=>g.independent))addGroup(group,independentQuota);
 for(const group of ordered)addGroup(group,historyQuota);
 const groupTasks=priorityHistory.length;
 const repairLimit=Math.min(MAX_REPAIRS,maxHistoryRechecks,maxItemHistories-groupTasks);
 const repairTasks=orderGroups(repairs,slot).filter(g=>!catalogIds.has(g.id)).flatMap(g=>g.tasks.slice(0,1)).slice(0,repairLimit);
 priorityHistory.push(...repairTasks.map(t=>priorityTask(t,'history_review')));
 // As demais fases conservam suas vagas e os grupos de historico.
 const itemIds=new Set(items.map(t=>t.id));
 const availableHistories=ordered.concat(orderGroups(largeGroups,slot)).filter(g=>!itemIds.has(g.id)).flatMap(g=>g.tasks);
 // A fila dirigida pode encontrar historicos que nao estavam na amostra
 // mensal inicial; ocupar vagas livres sem ampliar o teto configurado.
 const historyLimit=Math.min(maxItemHistories+maxHistoryRechecks,Math.max(baseHistory.length,priorityHistory.length,
  Math.min(maxItemHistories,availableHistories.length)));
 const histories=unique([...priorityHistory,...baseHistory.filter(t=>eligible(t)&&!itemIds.has(t.id)),...availableHistories]).slice(0,historyLimit);
 const other=base.filter(t=>!isNeTask(t));
 // Duas vagas de catalogo novo por ciclo enquanto houver passivo, sem
 // retirar tarefas das demais fases. Revisoes seguem depois das recuperacoes.
 const first=items.filter(t=>t.initialCatalog),reviews=items.filter(t=>!t.initialCatalog);
 const tasks=interleave([first.filter((_,i)=>i%2===0),first.filter((_,i)=>i%2===1),
   [...histories],other.filter(t=>t.kind==='liquidation'),other.filter(t=>t.kind==='payment'),
   other.filter(t=>!['liquidation','payment'].includes(t.kind)),reviews]);
 return {tasks,summary:{groupsSelected,groupTasks,catalogTasks:priorityItems.length,repairTasks:repairTasks.length,
   eligibleSmallGroups:groups.length,eligibleCatalogs:catalogs.length,eligibleHistoryReviews:repairs.length,
   independentHistoryNotes:[...groups,...largeGroups].filter(g=>g.independent).length,
   independentHistoryTasks:histories.filter(t=>needsIndependentHistory(byId.get(t.id))).length,
   historyTasksByYear:Object.fromEntries([...new Set(histories.map(t=>t.id.slice(11,15)))].map(y=>[y,histories.filter(t=>t.id.slice(11,15)===y).length])),
   initialCatalogEligible:missing.length,initialCatalogSelected:initialTasks.length,initialCatalogByYear:Object.fromEntries([...new Set(initial.map(x=>x.year))].map(y=>[y,initial.filter(x=>x.year===y).length])),
   contractCatalogTasks:items.filter(t=>contractual(t.id)).length,contractHistoryTasks:histories.filter(t=>contractual(t.id)).length,
   filledCatalogSlots:items.filter(t=>!baseItems.some(b=>key(b)===key(t))).length,
   filledHistorySlots:Math.max(0,histories.length-unique([...priorityHistory,...baseHistory.filter(t=>eligible(t)&&!itemIds.has(t.id))]).length)}};
}

/** Apos concluir um catalogo pequeno, recuperar seus historicos na mesma
 * rodada, substituindo apenas vagas ainda nao tentadas e sem aumentar o lote.
 * Nao desaloca grupos de fechamento nem tarefas de NS/OB. */
export function promoteCatalogHistories(tasks,index,record,{remaining=6,state={},now=new Date()}={}){
 const work=classifyChronologyWork(record,{state,now});
 if(work.kind!=='history'||!work.canFinish||work.tasks.length>MAX_FOLLOWUP||work.tasks.length>remaining)return 0;
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

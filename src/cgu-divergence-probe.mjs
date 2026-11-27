/** Diagnostico efemero de divergencias NE: listagem x detalhe x itens x movimentos.
 * Nunca persiste respostas, valores, datas exatas, identificadores ou novos vinculos.
 * Usa o mesmo orcamento HTTP e a mesma cadencia do enriquecimento existente. */
import {indexCommitmentChronology,commitmentChronologyEvidence,reconcileSiafiCommitment} from '../assets/siafi-movement-reconciliation.js';
import {parseMoneyCents} from './cgu.mjs';
import {fetchCguOriginal,summarizeOriginalIssueFields} from './recover-cgu-originals.mjs';
import {resolveItems} from './enrich-cgu.mjs';
import {resolveItemMovements} from './item-movements.mjs';
import {stateKey,validDay} from './operational-state.mjs';
import {reconstructValueMeasures,classifyValueMeaning,readFreshListingValue,classifySourceAgreement} from './cgu-value-semantics.mjs';

const DAY=86400000,MAX_NOTES=2,MAX_ITEMS=8;
const increment=(map,key)=>{map[key]=(map[key]||0)+1};
const reference=record=>[ {date:record.owners[0].doc.date,cents:record.owners[0].doc.cents},
 ...record.observations ].sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
const divergent=record=>record.owners.length===1&&
 commitmentChronologyEvidence(record.owners[0].doc,record.owners[0].items,record.observations).reason==='catalog_amount_mismatch';
function catalogSum(items){
 if(!Array.isArray(items)||!items.length||items.some(x=>!Number.isSafeInteger(x.seq)||x.seq<1||
    !Number.isSafeInteger(x.cents)||x.cents<0)||new Set(items.map(x=>x.seq)).size!==items.length)return null;
 const sum=items.reduce((n,x)=>n+BigInt(x.cents),0n);
 return sum<=BigInt(Number.MAX_SAFE_INTEGER)?Number(sum):null;
}
const catalogSignature=items=>JSON.stringify(items.map(i=>[i.seq,i.cents]).sort((a,b)=>a[0]-b[0]));
export function divergenceProbeKey(record,kind='attempt'){
 const {doc,items}=record.owners[0],ref=reference(record);
 return stateKey(['cgu-divergence-probe-v1',kind,doc.id,doc.date,doc.cents,ref.date,ref.cents,
  items.map(i=>[i.seq,i.cents,i.historyChecked===true,(i.movements||[]).map(m=>[m.date,m.type,m.cents])])]);
}
function recent(stamp,today,days){
 return validDay(stamp)&&stamp<=today&&Date.parse(today)-Date.parse(stamp)<days*DAY;
}
/** Nao compara subtotal de uma amostra com o valor integral da NE.
 * A soma na data de listagem so e examinada quando TODOS os historicos
 * reconstituem os valores atuais dos respectivos itens, sem operacao ambigua. */
export function compareDivergentTimeline(record,items,{today}={}){
 const ref=reference(record);
 const r=reconcileSiafiCommitment(items,{commitmentYear:record.id.slice(11,15)});
 const history=r.status==='reconciled'?'reconciled_to_catalog':
  r.status==='divergent'?'divergent_from_catalog':r.status==='partial'?'partial':'unavailable';
 const result={history,timeline:'not_comparable'};
 if(history!=='reconciled_to_catalog'||!validDay(today)||!validDay(ref.date)||ref.date>today||
    !Number.isSafeInteger(ref.cents))return result;
 const events=items.flatMap(i=>i.movements||[]);
 if(events.some(m=>m.date<'2024-01-01'||m.date>today))return {history:'outside_window',timeline:'not_comparable'};
 if(r.reportedCents===ref.cents)return {...result,timeline:'reference_matches_catalog'};
 if(!events.some(m=>m.date>ref.date))return {...result,timeline:'no_later_movements'};
 const asOf=events.filter(m=>m.date<=ref.date).reduce((n,m)=>n+
   (m.type==='original'||m.type==='reinforcement'?1n:-1n)*BigInt(m.cents),0n);
 return {...result,timeline:asOf===BigInt(ref.cents)?'reference_matches_reconstruction_at_listing':'reference_differs_from_reconstruction_at_listing'};
}
function aggregateStored(records,today){
 const output={history:{},timeline:{}};
 for(const r of records){
  const result=compareDivergentTimeline(r,r.owners[0].items,{today});
  increment(output.history,result.history);increment(output.timeline,result.timeline);
 }
 return output;
}
/** Contratos tem no maximo uma vaga reservada; demais notas continuam em rodizio.
 * Consulta concluida: 7 dias; tentativa incompleta: 2 dias; evidencia nova libera.
 * Excluir itens ja planejados na fila regular evita duplicar consultas na rodada. */
export function planDivergenceProbes(months,{cguContracts=[],excludeIds=[],state={},now=new Date(),
 today=now.toISOString().slice(0,10),slot=0,limit=MAX_NOTES}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_NOTES||!Number.isSafeInteger(slot)||slot<0||
    !validDay(today))throw Error('Plano de sondagem invalido');
 const cacheDay=now.toISOString().slice(0,10),contracts=new Set(cguContracts.flatMap(c=>c.refs||[]));
 const excluded=new Set(excludeIds),all=indexCommitmentChronology(months).entries.filter(divergent);
 let deferred=0,scheduledElsewhere=0;
 const candidates=[];
 for(const r of all){
  if(recent(state[divergenceProbeKey(r,'complete')],cacheDay,7)||
     recent(state[divergenceProbeKey(r)],cacheDay,2)){deferred++;continue}
  if(excluded.has(r.id)){scheduledElsewhere++;continue}
  candidates.push({record:r,contractual:contracts.has(r.id),last:state[divergenceProbeKey(r)]||''});
 }
 const order=(a,b)=>a.last.localeCompare(b.last)||a.record.id.localeCompare(b.record.id);
 candidates.sort(order);
 // Preferir os menos recentemente tentados, rotacionando empates.
 const rotateTies=rows=>{
  const out=[];
  for(const stamp of [...new Set(rows.map(x=>x.last))]){
   const group=rows.filter(x=>x.last===stamp),offset=slot%group.length;
   out.push(...group.slice(offset),...group.slice(0,offset));
  }
  return out;
 };
 const ranked=rotateTies(candidates);
 const priority=ranked.find(x=>x.contractual);
 const selected=(priority&&limit>1?[priority,...ranked.filter(x=>x!==priority)]:ranked).slice(0,limit);
 return {selected,summary:{divergent:all.length,eligible:candidates.length,deferred,scheduledElsewhere,
  selected:selected.length,selectedContractual:selected.filter(x=>x.contractual).length,
  stored:aggregateStored(all,today)}};
}
/** Sub-limite de trabalho dentro do orcamento pai, nao um orcamento adicional.
 * Observa os mesmos codigos HTTP e preserva o intervalo entre requisicoes. */
export function createDivergenceProbeBudget(parent,{requests,durationMs,clock=()=>Date.now()}){
 if(!parent||!Number.isSafeInteger(requests)||requests<1||requests>24||
    !Number.isSafeInteger(durationMs)||durationMs<1||durationMs>90000)throw Error('Limite da sondagem invalido');
 const start=clock();let used=0;
 const stopped=()=>parent.stopped()||(used>=requests?'probe_request_limit':
  clock()-start>=durationMs?'probe_time_limit':null);
 return {stopped,observe:status=>parent.observe(status),
  async beforeRequest(){
   if(stopped())throw Object.assign(Error('Limite da sondagem CGU'),{code:'CGU_BUDGET_STOP'});
   await parent.beforeRequest();used++;
  },
  snapshot:()=>({requests:used,elapsedMs:Math.max(0,clock()-start),stopReason:stopped()})};
}
function chooseItems(items,slot,max){
 const ordered=[...items].sort((a,b)=>a.seq-b.seq);
 if(ordered.length<=max)return ordered;
 const offset=slot%ordered.length;
 return ordered.slice(offset).concat(ordered.slice(0,offset)).slice(0,max);
}
function classifyDetail(record,raw,now){
 const identity=summarizeOriginalIssueFields(record.id,raw,{now});
 if(!identity.identityConfirmed||!identity.phaseConfirmed)return {status:'identity_unverified',cents:null,dateClass:'unverified'};
 const cents=parseMoneyCents(raw.valor);
 return {status:Number.isSafeInteger(cents)&&cents>=0?'verified':'amount_unavailable',cents,
  dateClass:identity.dateClasses.data};
}
function detailRelation(detail,ref,catalog){
 if(detail.status!=='verified'||catalog===null)return 'not_comparable';
 const a=detail.cents===ref,b=detail.cents===catalog;
 return a&&b?'matches_both':a?'matches_reference_only':b?'matches_fresh_catalog_only':'matches_neither';
}
/** Retorna somente classes e contagens. Nem mesmo o codigo da NE e retornado. */
export async function inspectDivergentRecord(record,{token,budget,now=new Date(),
 today=now.toISOString().slice(0,10),slot=0,maxItems=MAX_ITEMS,
 requestDetail=fetchCguOriginal,requestItems=resolveItems,requestHistory=resolveItemMovements,requestDay}={}){
 if(!divergent(record)||!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>MAX_ITEMS||
    !Number.isSafeInteger(slot)||slot<0||!validDay(today))throw Error('Sondagem invalida');
 const result={detail:'not_checked',detailDate:'not_checked',detailRelation:'not_comparable',
  catalog:'not_checked',history:'not_checked',timeline:'not_comparable',pattern:'unresolved',
  items:0,historiesChecked:0,historiesSampled:0,fullyQueried:false,
  semanticStatus:'not_comparable',storedMeaning:'not_comparable',detailMeaning:'not_comparable',
  listingMeaning:'not_comparable',listingStatus:'not_checked',sourceAgreement:'not_comparable'};
 let detail={status:'unavailable',cents:null,dateClass:'unavailable'};
 try{detail=classifyDetail(record,await requestDetail(record.id,{token,budget}),now)}catch{}
 result.detail=detail.status;result.detailDate=detail.dateClass;
 if(detail.status==='identity_unverified'||budget?.stopped())return result;
 let fresh;
 try{fresh=await requestItems(record.id,{token,budget,limit:8})}catch{}
 if(fresh?.ok!==true){result.catalog='unavailable';return result}
 const sum=catalogSum(fresh.items);
 if(sum===null){result.catalog=Array.isArray(fresh.items)&&!fresh.items.length?'empty':'invalid';return result}
 const ref=reference(record).cents;
 result.items=fresh.items.length;
 result.catalog=sum===ref?'matches_reference':
  catalogSignature(fresh.items)===catalogSignature(record.owners[0].items)?'unchanged_divergent':'changed_still_divergent';
 result.detailRelation=detailRelation(detail,ref,sum);
 const picked=chooseItems(fresh.items,slot,maxItems),bySeq=new Map();
 for(const i of picked){
  if(budget?.stopped())break;
  result.historiesSampled++;
  let h;
  try{h=await requestHistory(record.id,i.seq,{token,budget,limit:8})}catch{}
  if(h?.ok===true&&Array.isArray(h.movements)){result.historiesChecked++;bySeq.set(i.seq,h.movements)}
 }
 const evidence=fresh.items.map(i=>({seq:i.seq,cents:i.cents,historyChecked:bySeq.has(i.seq),
  movements:bySeq.get(i.seq)||[]}));
 const timeline=compareDivergentTimeline(record,evidence,{today});
 Object.assign(result,timeline);
 const reconstruction=reconstructValueMeasures(record,evidence,{today});
 result.semanticStatus=reconstruction.status;
 result.storedMeaning=classifyValueMeaning(ref,reconstruction);
 result.detailMeaning=classifyValueMeaning(detail.status==='verified'?detail.cents:null,reconstruction);
 // A listagem e complementar, realizada so quando ainda houver vaga no suborcamento.
 // Nos testes com adaptadores simulados, somente consultar o adaptador de listagem injetado.
 if(!budget?.stopped()&&(requestDay||requestDetail===fetchCguOriginal)){
  const listing=await readFreshListingValue(record,{token,budget,now,today,requestDay});
  result.listingStatus=listing.status;
  result.listingMeaning=classifyValueMeaning(listing.status==='verified'?listing.cents:null,reconstruction);
  result.sourceAgreement=classifySourceAgreement(ref,detail,listing);
 }
 result.fullyQueried=detail.status==='verified'&&result.historiesChecked===result.items;
 if(result.detailRelation==='matches_both'&&result.history==='reconciled_to_catalog')result.pattern='current_sources_match_reference';
 else if(result.detailRelation==='matches_fresh_catalog_only'&&result.timeline==='reference_matches_reconstruction_at_listing')
  result.pattern='temporal_pattern_supported';
 else if(result.detailRelation==='matches_reference_only'&&result.history==='reconciled_to_catalog')
  result.pattern='document_and_catalog_remain_different';
 return result;
}
/** Executado antes do enriquecimento regular, limitado a 10% das requisicoes
 * e 15% do tempo (no maximo 24 requisicoes / 90s), sem nova agenda. */
export async function runDivergenceProbes(plan,{token,parent,limits,state={},now=new Date(),
 today=now.toISOString().slice(0,10),slot=0,requestDetail,requestItems,requestHistory,requestDay,clock}={}){
 const report={planned:plan.selected.length,attempted:0,fullyQueried:0,items:0,historiesChecked:0,
  historiesSampled:0,detail:{},detailDate:{},detailRelation:{},catalog:{},history:{},timeline:{},pattern:{},byYear:{},
  semanticStatus:{},storedMeaning:{},detailMeaning:{},listingMeaning:{},listingStatus:{},sourceAgreement:{}};
 if(!plan.selected.length)return {...report,requests:0,elapsedMs:0,stopReason:null,parentStopped:null};
 const budget=createDivergenceProbeBudget(parent,{requests:Math.min(24,Math.max(1,Math.floor(limits.requests*.1))),
  durationMs:Math.min(90000,Math.max(1,Math.floor(limits.durationMs*.15))),clock});
 const day=now.toISOString().slice(0,10);
 for(const row of plan.selected){
  if(budget.stopped())break;
  const before=budget.snapshot().requests;
  const result=await inspectDivergentRecord(row.record,{token,budget,now,today,slot,requestDetail,requestItems,requestHistory,requestDay});
  if(budget.snapshot().requests===before)continue;
  report.attempted++;
  increment(report.byYear,row.record.id.slice(11,15));
  for(const k of ['detail','detailDate','detailRelation','catalog','history','timeline','pattern','semanticStatus','storedMeaning','detailMeaning','listingMeaning','listingStatus','sourceAgreement'])increment(report[k],result[k]);
  for(const k of ['items','historiesChecked','historiesSampled'])report[k]+=result[k];
  if(result.fullyQueried)report.fullyQueried++;
  // Restricoes da fonte nao sao falha individual: nao bloquear o documento.
  if(!parent.stopped()||result.fullyQueried){
   state[divergenceProbeKey(row.record)]=day;
   if(result.fullyQueried)state[divergenceProbeKey(row.record,'complete')]=day;
  }
 }
 return {...report,...budget.snapshot(),parentStopped:parent.stopped()};
}

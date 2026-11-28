/** Conferência autenticada de lacunas localizadas em CSV.
 * Por padrão somente leitura; --apply-confirmed recupera lacunas estritas
 * com dados normalizados da API, nunca importa valores do CSV.
 * Não registra IDs, valores ou respostas, não infere saldo. */
import {readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCguBudget} from './cgu-budget.mjs';
import {resolveItemMovements} from './item-movements.mjs';
import {resolvePaymentLinks,resolveLiquidationLinks} from './enrich-cgu.mjs';
import {isRapInscription,IMPACT_FIELDS,validateImpactComponents} from './rap-evidence.mjs';
import {validateManifest,validateMonth,applyDocumentEnrichment,persistEnrichment,validatePublishedData,applyTargetedDocument,persistTargetedPaymentWithLinks} from './store.mjs';
import {fetchCguDocumentDetail,normalizeRelatedFinancialDetail} from './recover-cgu-originals.mjs';

const NE=/^158459\d{5}20\d{2}NE\d{6}$/;
const SOURCE=/^158459\d{5}20\d{2}(NS|OB|DF)\d{6}$/;
const year=id=>Number(id.slice(11,15));
const valid=(id,re)=>typeof id==='string'&&re.test(id)&&year(id)>=2024;
const keys=Object.keys(IMPACT_FIELDS);
const exact=(o,fields)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===fields.length&&fields.every(k=>Object.hasOwn(o,k));
const iso=s=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s&&s>='2024-01-01';
const decimal=s=>{
 if(typeof s!=='string'||! /^-?\d{1,12}(?:\.\d{1,8})?$/.test(s))return null;
 const negative=s.startsWith('-'),[whole,frac='']=s.replace(/^-/,'').split('.');
 const w=whole.replace(/^0+(?=\d)/,''),f=frac.replace(/0+$/,'');
 return (negative&&(w!=='0'||f)?'-':'')+w+(f?'.'+f:'');
};
const label=s=>typeof s==='string'?s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim():null;
const signature=e=>JSON.stringify([e.date,label(e.operation),decimal(e.quantity),decimal(e.unitPrice),e.cents]);
export function validateCsvPlan(plan){
 if(!exact(plan,['version','histories','impacts'])||plan.version!==1||
   !Array.isArray(plan.histories)||plan.histories.length>4||!Array.isArray(plan.impacts)||plan.impacts.length>16)
  throw Error('Plano CSV inválido');
 const hist=new Set(),pairs=new Set(),docs=new Set();
 for(const h of plan.histories){
  if(!exact(h,['id','seq','events'])||!valid(h.id,NE)||!Number.isSafeInteger(h.seq)||h.seq<1||h.seq>100000||
    !Array.isArray(h.events)||!h.events.length||h.events.length>100||hist.has(h.id+'/'+h.seq))
   throw Error('Histórico CSV inválido');
  hist.add(h.id+'/'+h.seq);const sigs=new Set();let count=0;
  for(const e of h.events){
   if(!exact(e,['date','operation','quantity','unitPrice','cents','count'])||!iso(e.date)||
     !isRapInscription(e)||label(e.operation)!==e.operation||decimal(e.quantity)===null||
     decimal(e.unitPrice)===null||!Number.isSafeInteger(e.cents)||!Number.isSafeInteger(e.count)||e.count<1||
     sigs.has(signature(e)))throw Error('Ocorrência CSV inválida');
   sigs.add(signature(e));count+=e.count;
  }
  if(count>100)throw Error('Limite de ocorrências CSV');
 }
 for(const row of plan.impacts){
  if(!exact(row,['id','ne','phase','components'])||!valid(row.id,SOURCE)||!valid(row.ne,NE)||
    year(row.id)<year(row.ne)||(row.phase===2&&year(row.id)===year(row.ne))||row.phase!==(row.id.slice(15,17)==='NS'?2:3)||
    !exact(row.components,keys)||keys.some(k=>row.components[k]!==null&&!Number.isSafeInteger(row.components[k]))||
    keys.every(k=>row.components[k]===null)||pairs.has(row.id+'/'+row.ne))throw Error('Impacto CSV inválido');
  pairs.add(row.id+'/'+row.ne);docs.add(row.id);
 }
 if(docs.size>6)throw Error('Limite de documentos CSV');
 for(const r of plan.impacts)if(year(r.id)===year(r.ne)&&
   !plan.impacts.some(x=>x.id===r.id&&x.phase===3&&year(x.id)>year(x.ne)&&x.components.rpPaidCents>0))
  throw Error('Complemento sem alvo RAP interanual');
 return plan;
}
const emptyFields=()=>Object.fromEntries(keys.map(k=>[k,{equal:0,different:0,unavailable:0}]));
const count=(map,k,n)=>map.set(k,(map.get(k)||0)+n);
export async function auditCsvTargets(plan,{token,budget,historyResolver=resolveItemMovements,
 paymentResolver=resolvePaymentLinks,liquidationResolver=resolveLiquidationLinks,confirmed=null}={}){
 validateCsvPlan(plan);
 const out={history:{planned:plan.histories.length,attempted:0,completed:0,unavailable:0,sameMultiset:0,
  differentMultiplicity:0,differentContent:0,csvOnlyOccurrences:0,apiOnlyOccurrences:0,
  origin2025Confirmed:0},impacts:{plannedPairs:plan.impacts.length,plannedDocuments:0,attemptedDocuments:0,
  completedDocuments:0,unavailableDocuments:0,matchedPairs:0,missingPairs:0,allComparableFieldsEqual:0,
  fields:emptyFields()}};
 const groups=new Map();
 for(const r of plan.impacts){if(!groups.has(r.id))groups.set(r.id,[]);groups.get(r.id).push(r);}
 const documents=[...groups.values()];out.impacts.plannedDocuments=documents.length;
 for(let i=0;i<Math.max(documents.length,plan.histories.length);i++){
  const h=plan.histories[i];
  if(h&&!budget?.stopped()){
   const a=out.history;a.attempted++;
   const fresh=await historyResolver(h.id,h.seq,{token,budget,limit:4});
   if(!fresh.ok)a.unavailable++;
   else {
    a.completed++;const csv=new Map(),api=new Map();
    for(const e of h.events)count(csv,signature(e),e.count);
    for(const e of fresh.movements.filter(isRapInscription))count(api,signature(e),1);
    const sameKeys=csv.size===api.size&&[...csv.keys()].every(k=>api.has(k));
    const same=sameKeys&&[...csv].every(([k,n])=>api.get(k)===n);
    a[same?'sameMultiset':sameKeys?'differentMultiplicity':'differentContent']++;
    if(same&&year(h.id)===2025)a.origin2025Confirmed++;
    if(same&&confirmed)confirmed.histories.push({id:h.id,seq:h.seq,movements:fresh.movements});
    for(const [k,n] of csv)a.csvOnlyOccurrences+=Math.max(0,n-(api.get(k)||0));
    for(const [k,n] of api)a.apiOnlyOccurrences+=Math.max(0,n-(csv.get(k)||0));
   }
  }
  const rows=documents[i];
  if(rows&&!budget?.stopped()){
   const a=out.impacts;a.attemptedDocuments++;
   const result=await (rows[0].phase===2?liquidationResolver:paymentResolver)(rows[0].id,
    {token,budget,limit:4,includeRapComponents:true});
   if(!result.ok){a.unavailableDocuments++;continue;}
   a.completedDocuments++;
   for(const row of rows){
    const found=result.links.filter(l=>l.to===row.ne&&l.from===row.id);
    if(found.length!==1){a.missingPairs++;continue;}
    a.matchedPairs++;
    let compared=0,allEqual=true;
    for(const k of keys){
     if(row.components[k]===null)continue;
     const n=found[0].impactComponents?.[k],known=Number.isSafeInteger(n)&&!found[0].impactComponents?.repeatedRows;
     const cat=!known?'unavailable':n===row.components[k]?'equal':'different';
     a.fields[k][cat]++;
     if(cat==='equal'||cat==='different')compared++;
     if(cat!=='equal')allEqual=false;
    }
    if(compared&&allEqual)a.allComparableFieldsEqual++;
    // Exigir os quatro campos pertinentes do CSV, e os cinco da API.
    // Campos de outra fase podem estar ausentes no CSV, nunca inferidos.
    const required=[row.phase===2?'liquidatedCents':'paidCents','rpInscribedCents','rpCancelledCents','rpPaidCents'];
    const c=found[0].impactComponents;
    if(confirmed&&allEqual&&required.every(k=>Number.isSafeInteger(row.components[k]))&&
       c?.repeatedRows===0&&keys.every(k=>Number.isSafeInteger(c[k])))
     confirmed.impacts.push({id:row.id,ne:row.ne,phase:row.phase,link:found[0],apiLinks:result.links});
   }
  }
 }
 return out;
}
/** Pagamento novo: exigir o conjunto integral da resposta autenticada,
 * preservar todos os pares/centavos legados e confirmar por CSV cada par
 * que será acrescentado. Nunca promover identidade temporal isolada. */
function verifiedPaymentAdditions(rows,old){
 const incoming=rows[0]?.apiLinks,id=rows[0]?.id;
 const fail=reason=>({additions:null,reason});
 if(!Array.isArray(incoming)||!incoming.length||
    new Set(incoming.map(l=>l.to)).size!==incoming.length||
    incoming.some(l=>l.from!==id||!Number.isSafeInteger(l.cents)))
  return fail('invalid_api_set');
 if(!old.every(l=>incoming.some(x=>x.from===l.from&&x.to===l.to)))
  return fail('legacy_pair_missing');
 if(!old.every(l=>incoming.some(x=>x.from===l.from&&x.to===l.to&&x.cents===l.cents)))
  return fail('legacy_amount_changed');
 if(!old.every(l=>!l.impactComponents||incoming.some(x=>x.to===l.to&&
    keys.every(k=>l.impactComponents[k]===null||l.impactComponents[k]===x.impactComponents?.[k]))))
  return fail('legacy_components_changed');
 const additions=incoming.filter(x=>!old.some(l=>l.to===x.to));
 if(!additions.length)return fail('no_new_pair');
 if(additions.some(x=>!valid(x.to,NE)||year(id)<year(x.to)))return fail('new_pair_outside_scope');
 if(!additions.some(x=>year(id)>year(x.to)&&x.impactComponents?.rpPaidCents>0))
  return fail('no_positive_interannual_seed');
 for(const x of additions){
  const evidence=rows.find(r=>r.id===id&&r.ne===x.to&&r.phase===3&&r.apiLinks===incoming&&r.link===x);
  if(!evidence)return fail('new_pair_not_crosschecked');
  const c=x.impactComponents;
  if(c?.repeatedRows!==0||!keys.every(k=>Number.isSafeInteger(c[k])))return fail('new_pair_incomplete_components');
  try{validateImpactComponents(c,x,3);}catch{return fail('new_pair_invalid_components');}
 }
 return {additions,reason:null};
}
function paymentGroups(confirmed){
 const groups=new Map();
 for(const r of confirmed.impacts){
  if(r.phase!==3||!valid(r.id,SOURCE)||!['OB','DF'].includes(r.id.slice(15,17)))continue;
  if(!groups.has(r.id))groups.set(r.id,[]);
  groups.get(r.id).push(r);
 }
 return groups;
}
export async function fetchMissingPaymentDetails(months,confirmed,{token,budget,now=new Date(),fetchDetail=fetchCguDocumentDetail}={}){
 const present=new Set(months.flatMap(m=>m.documents.map(d=>d.id))),details=new Map();
 const report={attempted:0,verified:0,unavailable:0};
 for(const [id,rows] of paymentGroups(confirmed)){
  if(present.has(id)||!verifiedPaymentAdditions(rows,[]).additions||budget?.stopped())continue;
  if(report.attempted>=6)break;
  report.attempted++;
  try{
   const doc=normalizeRelatedFinancialDetail(id,await fetchDetail(id,{token,budget}),{now});
   if(!Number.isSafeInteger(doc.cents))throw Error('Valor documental indisponível');
   details.set(id,doc);report.verified++;
  }catch{report.unavailable++;}
 }
 return {details,report};
}

/** Plano de enriquecimento estritamente aditivo; nenhuma retificação.
 * Reutiliza o validador e o gravador canônico. Todos os documentos e pares
 * legados devem continuar idênticos em identidade/centavos. */
export function planConfirmedCsvRecovery(months,confirmed,now=new Date(),details=new Map()){
 const working=new Map(),owners=new Map(),tasks=[];
 const summary={historiesEligible:confirmed.histories.length,impactsEligible:confirmed.impacts.length,
  historiesAdded:0,impactsAdded:0,paymentPairsAdded:0,paymentDocumentsAdded:0,
  paymentGapDocuments:0,paymentGapReasons:{},skipped:{},monthsChanged:0};
 const skip=reason=>summary.skipped[reason]=(summary.skipped[reason]||0)+1;
 for(const m of months){
  validateMonth(m);
  if(working.has(m.month))throw Error('Competência duplicada');
  working.set(m.month,m);
  for(const d of m.documents){
   if(!owners.has(d.id))owners.set(d.id,[]);
   owners.get(d.id).push(m.month);
  }
 }
 const owner=id=>{
  const m=owners.get(id);
  return m?.length===1?working.get(m[0]):null;
 };
 const changed=new Set();
 const add=(m,id,result)=>{
  const outcome=applyDocumentEnrichment(m,id,result,now);
  if(!outcome.changed)return false;
  working.set(m.month,outcome.data);changed.add(m.month);
  tasks.push({month:m.month,id,result});return true;
 };
 for(const h of confirmed.histories){
  const m=owner(h.id),doc=m?.documents.find(d=>d.id===h.id);
  const items=m?.itemsByDocument?.[h.id]||[],item=items.find(i=>i.seq===h.seq);
  if(!m||!valid(h.id,NE)||doc?.phase!==1||doc.itemsDetailVersion!==2||!item){
   skip('history_owner_or_catalog_missing');continue;
  }
  if(item.historyChecked===true){skip('history_already_checked');continue;}
  if(!Array.isArray(h.movements)||!h.movements.some(isRapInscription)){
   skip('history_without_qualified_evidence');continue;
  }
  try{
   if(add(m,h.id,{kind:'itemHistory',seq:h.seq,movements:h.movements,
    checkedAt:now.toISOString().slice(0,10)}))summary.historiesAdded++;
  }catch{skip('history_validation_failed');}
 }
 // Antes da recuperação de componentes, tratar pares ausentes. Os
 // documentos existentes nunca têm seu valor ou data substituídos.
 for(const [id,rows] of paymentGroups(confirmed)){
  const m=owner(id),old=m?.relations.filter(l=>l.from===id)||[];
  if(!rows.some(r=>!old.some(l=>l.to===r.ne)))continue;
  summary.paymentGapDocuments++;
  if((owners.get(id)||[]).length>1){skip('payment_gap_ambiguous_owner');continue;}
  const {additions,reason}=verifiedPaymentAdditions(rows,old);
  if(!additions){
   skip('payment_gap_unconfirmed_complete_set');
   summary.paymentGapReasons[reason]=(summary.paymentGapReasons[reason]||0)+1;
   continue;
  }
  if(m){
   const doc=m.documents.find(d=>d.id===id);
   if(doc?.phase!==3){skip('payment_gap_phase_mismatch');continue;}
   try{
    if(add(m,id,{kind:'payment',links:[...old,...additions]}))summary.paymentPairsAdded+=additions.length;
   }catch{skip('payment_gap_validation_failed');}
  }else{
   const doc=details.get(id),month=doc?.date?.slice(0,7),existing=working.get(month);
   if(!doc||doc.id!==id||doc.phase!==3||!Number.isSafeInteger(doc.cents)||!existing){
    skip('payment_gap_detail_or_month_missing');continue;
   }
   try{
    const added=applyTargetedDocument(existing,doc,now);
    if(!added.changed)throw Error('Documento já existente');
    const result={kind:'payment',links:additions};
    const enriched=applyDocumentEnrichment(added.data,id,result,now);
    if(!enriched.changed)throw Error('Vínculos ausentes');
    working.set(month,enriched.data);owners.set(id,[month]);changed.add(month);
    tasks.push({month,id,result,newDocument:doc});
    summary.paymentPairsAdded+=additions.length;summary.paymentDocumentsAdded++;
   }catch{skip('payment_gap_coverage_or_validation_conflict');}
  }
 }
 for(const r of confirmed.impacts){
  if(r.phase===3&&year(r.id)===year(r.ne))continue;
  const m=owner(r.id),doc=m?.documents.find(d=>d.id===r.id);
  if(!m||!valid(r.id,SOURCE)||!valid(r.ne,NE)||year(r.id)<=year(r.ne)||
    doc?.phase!==r.phase||![2,3].includes(r.phase)||
    !(r.phase===2?doc.liquidationLinksChecked===true:doc.paymentLinksChecked===true)){
   skip('impact_owner_or_checkpoint_missing');continue;
  }
  const old=m.relations.filter(l=>l.from===r.id),target=old.find(l=>l.to===r.ne);
  if(!target){skip('impact_pair_missing');continue;}
  if(target.impactComponents){skip('impact_already_present');continue;}
  // Conferir o conjunto completo, inclusive vínculos fora da amostra CSV.
  // Não acrescentar, remover ou retificar qualquer par ou valor legado.
  const incoming=r.apiLinks;
  if(!Array.isArray(incoming)||incoming.length!==old.length||
    new Set(incoming.map(l=>l.to)).size!==incoming.length||
    !old.every(l=>incoming.some(x=>x.from===l.from&&x.to===l.to&&x.cents===l.cents))){
   skip('legacy_links_differ');continue;
  }
  const fresh=incoming.find(l=>l.from===r.id&&l.to===r.ne);
  const c=fresh?.impactComponents;
  if(!fresh||fresh!==r.link||c?.repeatedRows!==0||!keys.every(k=>Number.isSafeInteger(c[k]))){
   skip('impact_components_incomplete');continue;
  }
  try{
   validateImpactComponents(c,target,r.phase);
   const links=old.map(l=>l.to===r.ne?{...l,impactComponents:structuredClone(c)}:l);
   if(add(m,r.id,{kind:r.phase===2?'liquidation':'payment',links}))summary.impactsAdded++;
  }catch{skip('impact_validation_failed');}
 }
 summary.monthsChanged=changed.size;
 return {tasks,summary};
}
async function recoverConfirmed(root,confirmed,{token,budget}={}){
 const manifest=validateManifest(JSON.parse(await readFile(join(root,'data/manifest.json'),'utf8')));
 const months=[];
 for(const month of manifest.months.filter(m=>m>='2024-01'))
  months.push(validateMonth(JSON.parse(await readFile(join(root,'data/months',month+'.json'),'utf8'))));
 const now=new Date(),{details,report}=await fetchMissingPaymentDetails(months,confirmed,{token,budget,now});
 const stop=budget?.snapshot().stopReason;
 if(stop&&stop!=='request_budget'&&stop!=='time_budget')
  return {persisted:0,stopped:true,detailReport:report};
 const plan=planConfirmedCsvRecovery(months,confirmed,now,details);
 let persisted=0;
 for(const t of plan.tasks){
  const changed=t.newDocument?
   await persistTargetedPaymentWithLinks(root,t.newDocument,t.result.links,now):
   await persistEnrichment(root,t.month,t.id,t.result,now);
  if(!changed)throw Error('Checkpoint mudou durante recuperação');
  persisted++;
 }
 await validatePublishedData(root);
 return {...plan.summary,persisted,detailReport:report};
}
async function main(){
 const path=process.env.CGU_RAP_TARGETS_PATH;
 if(!path||(await stat(path)).size>256*1024)throw Error('Plano efêmero ausente ou excedido');
 const plan=validateCsvPlan(JSON.parse(await readFile(path,'utf8')));
 if(!plan.histories.length&&!plan.impacts.length){console.log('Sem novos alvos CSV elegíveis para API.');return;}
 const token=process.env.CGU_API_KEY;
 if(!token)throw Error('CGU_API_KEY ausente');
 const budget=createCguBudget({requests:48,durationMs:4*60*1000,spacingMs:1500});
 const apply=process.argv.includes('--apply-confirmed');
 const confirmed=apply?{histories:[],impacts:[]}:null;
 const report=await auditCsvTargets(plan,{token,budget,confirmed});
 console.log('Confronto autenticado dirigido por CSV (somente contagens): '+JSON.stringify(report));
 console.log('Orçamento HTTP CSV/API: '+JSON.stringify(budget.snapshot()));
 if(!report.history.completed&&!report.impacts.completedDocuments)throw Error('Nenhuma consulta concluída');
 // Restrição ou instabilidade da fonte impede gravação desta rodada.
 if(apply){
  const stop=budget.snapshot().stopReason;
  if(stop&&stop!=='request_budget'&&stop!=='time_budget'){
   console.log('Recuperação CSV/API interrompida por restrição ou instabilidade; nenhum dado gravado.');
  }else console.log('Recuperação CSV/API canônica (somente contagens): '+
   JSON.stringify(await recoverConfirmed(process.cwd(),confirmed,{token,budget})));
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main().catch(()=>{console.error('Confronto dirigido CSV/API não concluído; dados preservados.');process.exitCode=1;});

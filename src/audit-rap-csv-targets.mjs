/** Conferência autenticada de lacunas localizadas em CSV, somente leitura.
 * O plano temporário contém apenas identidades oficiais e campos estruturados.
 * Não grava acervo, não registra IDs, valores ou respostas, não infere saldo. */
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCguBudget} from './cgu-budget.mjs';
import {resolveItemMovements} from './item-movements.mjs';
import {resolvePaymentLinks,resolveLiquidationLinks} from './enrich-cgu.mjs';
import {isRapInscription,IMPACT_FIELDS} from './rap-evidence.mjs';

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
    year(row.id)<=year(row.ne)||row.phase!==(row.id.slice(15,17)==='NS'?2:3)||
    !exact(row.components,keys)||keys.some(k=>row.components[k]!==null&&!Number.isSafeInteger(row.components[k]))||
    keys.every(k=>row.components[k]===null)||pairs.has(row.id+'/'+row.ne))throw Error('Impacto CSV inválido');
  pairs.add(row.id+'/'+row.ne);docs.add(row.id);
 }
 if(docs.size>6)throw Error('Limite de documentos CSV');
 return plan;
}
const emptyFields=()=>Object.fromEntries(keys.map(k=>[k,{equal:0,different:0,unavailable:0}]));
const count=(map,k,n)=>map.set(k,(map.get(k)||0)+n);
export async function auditCsvTargets(plan,{token,budget,historyResolver=resolveItemMovements,
 paymentResolver=resolvePaymentLinks,liquidationResolver=resolveLiquidationLinks}={}){
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
   }
  }
 }
 return out;
}
async function main(){
 const path=process.env.CGU_RAP_TARGETS_PATH;
 if(!path||(await stat(path)).size>256*1024)throw Error('Plano efêmero ausente ou excedido');
 const plan=validateCsvPlan(JSON.parse(await readFile(path,'utf8')));
 if(!plan.histories.length&&!plan.impacts.length){console.log('Sem novos alvos CSV elegíveis para API.');return;}
 const token=process.env.CGU_API_KEY;
 if(!token)throw Error('CGU_API_KEY ausente');
 const budget=createCguBudget({requests:48,durationMs:4*60*1000,spacingMs:1500});
 const report=await auditCsvTargets(plan,{token,budget});
 console.log('Confronto autenticado dirigido por CSV (somente contagens): '+JSON.stringify(report));
 console.log('Orçamento HTTP CSV/API: '+JSON.stringify(budget.snapshot()));
 if(!report.history.completed&&!report.impacts.completedDocuments)throw Error('Nenhuma consulta concluída');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main().catch(()=>{console.error('Confronto dirigido CSV/API não concluído; dados preservados.');process.exitCode=1;});

/** Investigacao delimitada, sem modificar acervo nem publicar identificadores. */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {appendFile} from 'node:fs/promises';
import {collectDayPhase} from './cgu.mjs';
import {inScopeDate,inScopeNe} from './collection-scope.mjs';
import {currentDateInBrazil} from './backfill.mjs';
import {createCguBudget} from './cgu-budget.mjs';
import {fetchCguOriginal,summarizeOriginalIssueFields} from './recover-cgu-originals.mjs';
import {safeDocumentDateComparison} from './inspect-cgu-siafi.mjs';
import {resolveItems} from './enrich-cgu.mjs';
import {resolveItemMovements} from './item-movements.mjs';
import {validatePublishedData} from './store.mjs';

const validDate=value=>typeof value==='string'&&inScopeDate(value)&&
 Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const asBr=date=>date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);
const classify=(value,canonical,listing)=>{
 const a=safeDocumentDateComparison({data:value},{listingDate:canonical});
 const b=safeDocumentDateComparison({data:value},{listingDate:listing});
 return !a.dateFieldPresent?'not_provided':!a.validDate?'invalid':
   a.matchesListing?'canonical_date':b.matchesListing?'reconsulted_date':'other_date';
};
export function findConflictingCommitments(months,patch){
 if(patch?.coverage?.phase!==1||!Array.isArray(patch.documents))throw Error('Fase de diagnostico invalida');
 const byId=new Map();
 for(const month of months)for(const doc of month.documents){
  if(doc.phase!==1||!inScopeNe(doc.id))continue;
  if(!byId.has(doc.id))byId.set(doc.id,new Set());
  byId.get(doc.id).add(doc.date);
 }
 const found=[];
 for(const doc of patch.documents){
  if(!inScopeNe(doc.id))continue;
  for(const date of byId.get(doc.id)||[])
   if(date!==doc.date)found.push({id:doc.id,canonicalDate:date,listingDate:doc.date});
 }
 return found;
}
export async function diagnoseDateConflict({months,date,now=new Date(),token,budget,
 collect=collectDayPhase,detail=fetchCguOriginal,items=resolveItems,history=resolveItemMovements}={}){
 if(!validDate(date)||date>=currentDateInBrazil(now)||!token||!budget)throw Error('Data/credencial de diagnostico invalida');
 const patch=await collect(asBr(date),1,{token,budget,maxPages:15});
 const conflicts=findConflictingCommitments(months,patch);
 const summary={date,listingComplete:patch.coverage.complete,listingDocuments:patch.documents.length,
  conflicts:conflicts.length,sampled:0,samples:[]};
 for(const {id,canonicalDate,listingDate} of conflicts.slice(0,5)){
  if(budget.stopped())break;
  const sample={canonicalDate,listingDate,detailStatus:'unavailable',itemsStatus:'unavailable',historiesCompleted:0,historyItemsSampled:0,
   movements:{canonical_date:{},reconsulted_date:{},other_date:{}}};
  summary.sampled++;
  try{
   const payload=await detail(id,{token,budget});
   const identity=summarizeOriginalIssueFields(id,payload,{now});
   sample.detailStatus=identity.identityConfirmed&&identity.phaseConfirmed?'identity_verified':'identity_unverified';
   if(sample.detailStatus==='identity_verified'){
    sample.dateFields=Object.fromEntries(['data','dataEmissao','dataDocumento'].map(field=>[field,classify(payload[field],canonicalDate,listingDate)]));
    sample.dateClasses=identity.dateClasses;
    sample.dataMatchesEmissao=identity.dataMatchesEmissao;
   }
  }catch{} // Nunca registrar excecao ou resposta externa.
  if(!budget.stopped()){
   try{
    const result=await items(id,{token,budget,limit:4});
    if(result.ok){
     sample.itemsStatus='complete';sample.itemsCount=result.items.length;
     for(const item of result.items.slice(0,3)){
      if(budget.stopped())break;
      sample.historyItemsSampled++;
      const outcome=await history(id,item.seq,{token,budget,limit:4});
      if(!outcome.ok)continue;
      sample.historiesCompleted++;
      for(const m of outcome.movements){
       const group=m.date===canonicalDate?'canonical_date':m.date===listingDate?'reconsulted_date':'other_date';
       const type=['original','inclusion','reinforcement','annulment','cancellation','reversal','other','unknown'].includes(m.type)?m.type:'other';
       sample.movements[group][type]=(sample.movements[group][type]||0)+1;
      }
     }
    }
   }catch{} // Somente resultado agregado, amostragem nao prova emissao.
  }
  summary.samples.push(sample);
 }
 return {...summary,telemetry:budget.snapshot(),caution:'Diagnostico somente leitura: campos e movimentos nao autorizam trocar data canonica ou contar NE duas vezes.'};
}
async function main(){
 const {months}=await validatePublishedData(process.cwd());
 const result=await diagnoseDateConflict({months,date:process.env.CGU_CONFLICT_DATE,
  token:process.env.CGU_API_KEY,budget:createCguBudget({requests:40,durationMs:180000,spacingMs:1500})});
 const line='Diagnostico de datas CGU (sem IDs): '+JSON.stringify(result);
 console.log(line);
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,line+'\n');
 if(!result.listingComplete||result.conflicts>result.sampled||result.samples.some(s=>s.detailStatus!=='identity_verified'))
  console.warn('Diagnostico incompleto: manter data canonica e reavaliar com fonte oficial.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 main().catch(()=>{console.error('Diagnostico CGU interrompido; acervo inalterado.');process.exitCode=1});
}

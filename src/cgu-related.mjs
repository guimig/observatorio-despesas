/** Evidencia documental CGU /documentos-relacionados.
 * Somente NE<->NS/OB/DF integrais da UG 158459, desde 2024.
 * O valor da resposta e o valor do documento, NAO o impacto na NE.
 * Por isso conservamos somente IDs, em atributo separado de relations. */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {getCguArray} from './cgu.mjs';
import {relatedUrl} from './inspect-cgu-siafi.mjs';
import {createCguBudget} from './cgu-budget.mjs';
import {validatePublishedData,persistEnrichment} from './store.mjs';
import {readProcurement} from './procurement-store.mjs';
import {readCguContractEvidence} from './cgu-contract-evidence.mjs';
import {stateKey,readOperationalState,saveOperationalState,validDay} from './operational-state.mjs';
import {assertPublicSafe} from './privacy.mjs';
import {extractAraquariNeEvidence} from '../assets/procurement-links.js';
import {inScopeRelatedDocument,validRelatedPair} from '../assets/trajectory.js';
const PHASE={NE:1,NS:2,OB:3,DF:3};
const MAX_ROWS=3000;
const dayMs=86400000;
const phaseOf=id=>PHASE[id?.slice(15,17)];
const code=e=>Number.isInteger(e?.status)?'http_'+e.status:'unavailable_or_invalid';
export function normalizeRelatedRows(id,phase,rows){
 if(!inScopeRelatedDocument(id)||phaseOf(id)!==phase||!Array.isArray(rows)||rows.length>MAX_ROWS)
  throw Error('Resposta de documentos relacionados invalida');
 const ids=new Set();
 let excluded=0;
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.documento!=='string')
   throw Error('Identidade documental nao fornecida');
  if(validRelatedPair(id,row.documento))ids.add(row.documento);
  else excluded++;
 }
 return {ids:assertPublicSafe([...ids].sort()),excluded,rows:rows.length};
}
export async function resolveRelatedDocuments(doc,{token,budget,request=getCguArray}={}){
 if(!inScopeRelatedDocument(doc?.id)||phaseOf(doc.id)!==doc.phase)throw Error('Documento nao elegivel');
 const rows=await request(relatedUrl(doc.id,doc.phase),{token,budget});
 return normalizeRelatedRows(doc.id,doc.phase,rows);
}
const checkKey=d=>stateKey(['cgu-related-v1',d.id,d.phase,d.relatedIds??null]);
/** Balanceia consultas de NE e consultas inversas de documentos sem impacto.
 * Prioridade de NE: evidencia de instrumento/mesmo processo e credor, depois
 * demais, com rodizio temporal. Nenhuma prioridade constitui vinculo oficial. */
export function planRelatedDocuments(months,{contracts=[],cguContracts=[],state={},now=new Date(),limit=24}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>40)throw Error('Limite documental invalido');
 const today=now.toISOString().slice(0,10),docs=new Map(),ambiguous=new Set(),impacts=new Set();
 const declared=new Set(),short=new Set(),processParty=new Set();
 for(const c of cguContracts)for(const ref of c.refs||[])if(inScopeRelatedDocument(ref)&&phaseOf(ref)===1)declared.add(ref);
 for(const c of contracts){
  for(const raw of [c.number,...(c.commitmentRefs||[])]){
   const ev=extractAraquariNeEvidence(raw);
   if(ev?.kind==='full')declared.add(ev.ne);
   else if(ev?.kind==='ug_short')short.add(ev.short);
  }
  if(/^20\d{2}NE\d{6}$/.test(c.number||''))short.add(c.number);
  if(c.process&&/^\d{14}$/.test(c.supplierCnpj||''))processParty.add(c.process+'|'+c.supplierCnpj);
 }
 for(const m of months){
  for(const r of m.relations||[])impacts.add(r.from);
  for(const d of m.documents||[]){
   if(!inScopeRelatedDocument(d.id)||phaseOf(d.id)!==d.phase)continue;
   if(docs.has(d.id))ambiguous.add(d.id);
   else docs.set(d.id,{doc:d,month:m.month});
  }
 }
 const due=(d)=>{
  const stamp=state[checkKey(d)];
  if(!validDay(stamp)||stamp>today)return true;
  const interval=d.relatedIds===undefined?7:(d.phase===1?14:30);
  return now.getTime()-Date.parse(stamp+'T00:00:00Z')>=interval*dayMs;
 };
 const rank=d=>declared.has(d.id)?0:short.has(d.id.slice(-12))&&processParty.has(d.process+'|'+d.partyRef)?1:
  processParty.has(d.process+'|'+d.partyRef)?2:3;
 const pending=[],reverse=[],review=[];
 const incoming=new Set();for(const {doc:d} of docs.values())for(const id of d.relatedIds||[])if(validRelatedPair(d.id,id))incoming.add(id);
 for(const x of docs.values()){
  const d=x.doc;if(ambiguous.has(d.id)||!due(d))continue;
  if(d.relatedIds!==undefined){review.push(x);continue;}
  if(d.phase===1)pending.push(x);
  else if(incoming.has(d.id)||!impacts.has(d.id)||!(d.phase===2?d.liquidationLinksChecked:d.paymentLinksChecked))reverse.push(x);
 }
 const slot=Math.floor(now.getTime()/43200000);
 const rotate=items=>{
  const s=[...items].sort((a,b)=>a.doc.id.localeCompare(b.doc.id));
  if(!s.length)return s;
  const offset=(slot*limit)%s.length;return s.slice(offset).concat(s.slice(0,offset));
 };
 const priority=[];
 for(let n=0;n<=3;n++)priority.push(...rotate(pending.filter(x=>rank(x.doc)===n)));
 const backwards=rotate(reverse.filter(x=>incoming.has(x.doc.id))).concat(rotate(reverse.filter(x=>!incoming.has(x.doc.id))));
 // Reserva parte do lote para revisoes, sem consumir toda a fila.
 const reviews=rotate(review),reserve=reviews.length?Math.min(4,Math.floor(limit/5)):0;
 const available=limit-reserve,reverseLimit=backwards.length?Math.min(backwards.length,Math.max(1,Math.floor(available/3))):0;
 const selected=[...priority.slice(0,available-reverseLimit),...backwards.slice(0,reverseLimit),...reviews.slice(0,reserve)];
 const used=new Set(selected.map(x=>x.doc.id));
 for(const x of [...priority,...backwards,...reviews]){
  if(selected.length>=limit)break;if(!used.has(x.doc.id)){selected.push(x);used.add(x.doc.id);}
 }
 return selected.map(({doc,month})=>({doc,month}));
}
export async function collectRelatedDocuments({root=process.cwd(),token,now=new Date(),limit=24,
 statePath,request=getCguArray,budget=createCguBudget({requests:32,durationMs:180000}),dryRun=false}={}){
 const {months}=await validatePublishedData(root);
 const catalog=await readProcurement(root);
 const state=await readOperationalState(statePath,{now});
 const cguContracts=(await readCguContractEvidence(root)).contracts;
 const plan=planRelatedDocuments(months,{contracts:catalog?.contracts||[],cguContracts,state,now,limit});
 const report={planned:plan.length,attempted:0,checked:0,changed:0,references:0,excluded:0,failures:{}};
 if(dryRun)return report;
 if(!token)throw Error('CGU_API_KEY ausente');
 const today=now.toISOString().slice(0,10);
 for(const {doc,month} of plan){
  if(budget.stopped())break;
  report.attempted++;
  try{
   const r=await resolveRelatedDocuments(doc,{token,budget,request});
   const changed=await persistEnrichment(root,month,doc.id,{kind:'relatedDocuments',ids:r.ids},now);
   delete state[checkKey(doc)];state[checkKey({...doc,relatedIds:r.ids})]=today;
   report.checked++;if(changed)report.changed++;
   report.references+=r.ids.length;report.excluded+=r.excluded;
  }catch(e){
   const reason=e?.message==='Consulta de relacionados omitiu vinculo previamente identificado'?'previous_reference_omitted':code(e);
   report.failures[reason]=(report.failures[reason]||0)+1;
   // Falhas nunca sao consultas bem sucedidas; apenas espaçar a nova tentativa.
   state[checkKey(doc)]=today;
  }
 }
 await validatePublishedData(root);
 await saveOperationalState(statePath,state,{now});
 report.telemetry=budget.snapshot();return report;
}
async function main(){
 const r=await collectRelatedDocuments({token:process.env.CGU_API_KEY,statePath:process.env.CGU_RELATED_STATE_PATH,
  limit:Number(process.env.CGU_RELATED_LIMIT||24),dryRun:process.argv.includes('--dry-run')});
 console.log('CGU documentos relacionados: '+JSON.stringify(r));
 if(r.attempted&&!r.checked)process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(()=>{
 console.error('Consulta de relacionados CGU interrompida; acervo anterior preservado.');process.exitCode=1;
});

/** Sondagem dirigida de inscrições e impactos CGU, efêmera e somente leitura. */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateManifest,validateMonth} from './store.mjs';
import {getCguArray} from './cgu.mjs';
import {createCguBudget} from './cgu-budget.mjs';
import {historyUrl,resolveItemMovements} from './item-movements.mjs';
import {resolvePaymentLinks,resolveLiquidationLinks} from './enrich-cgu.mjs';
import {reviewRapItem,isRapInscription,summarizeRapEvidence,IMPACT_FIELDS} from './rap-evidence.mjs';

const NE=/^158459\d{5}20\d{2}NE\d{6}$/;
const DOC=/^158459\d{5}20\d{2}(NS|OB|DF)\d{6}$/;
const scope=id=>typeof id==='string'&&NE.test(id)&&Number(id.slice(11,15))>=2024;
const year=id=>Number(id.slice(11,15));
const moneyKeys=Object.keys(IMPACT_FIELDS);
const key=(event)=>JSON.stringify([event.date,event.operation,event.quantity,event.unitPrice,event.cents]);
const multiset=events=>{
 const out=new Map();
 for(const e of events){const k=key(e);out.set(k,(out.get(k)||0)+1);}
 return out;
};
const stable=value=>Array.isArray(value)?value.map(stable):
 value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const rawKey=value=>JSON.stringify(stable(value));
const sameCounts=(a,b)=>a.size===b.size&&[...a].every(([k,n])=>b.get(k)===n);
const candidateKeys=['id','idMovimentacao','codigoMovimentacao','sequencialMovimentacao','codigoEvento',
 'dataHora','dataLancamento','numeroDocumento','codigoDocumento','sequencial'];
const identityFields=rows=>Object.fromEntries(candidateKeys.map(k=>[k,rows.filter(r=>
  Object.hasOwn(r,k)&&r[k]!==null&&r[k]!=='').length]));
const reasons=new Set(['consulta_indisponivel','resposta_invalida','pagina_repetida','limite_paginacao',
 'movimentacao_invalida','impacto_nao_identificado','valor_fora_limite','acesso_negado',
 'recurso_nao_encontrado','erro_http']);
const safeReason=value=>reasons.has(value)?value:'other_failure';

/** Escolhe primeiro duplicidades conhecidas, depois inscrições não repetidas.
 * Só usa proprietários únicos, não procura exercício anterior a 2024. */
export function planTargetedRap(months,{historyLimit=10,impactLimit=6}={}){
 if(!Number.isSafeInteger(historyLimit)||historyLimit<1||historyLimit>12||
    !Number.isSafeInteger(impactLimit)||impactLimit<1||impactLimit>8)throw Error('Limites inválidos');
 const owners=new Map();
 for(const m of months)for(const d of m.documents||[]){
  if(!owners.has(d.id))owners.set(d.id,[]);
  owners.get(d.id).push({doc:d,month:m});
 }
 const histories=[],knownNotes=new Set(),duplicateNotes=new Set();
 for(const [id,entries] of owners){
  if(!scope(id)||entries.length!==1||entries[0].doc.phase!==1)continue;
  const items=entries[0].month.itemsByDocument?.[id]||[];
  if(new Set(items.map(i=>i.seq)).size!==items.length)continue;
  for(const item of items){
   if(item.historyChecked!==true||!Number.isSafeInteger(item.seq)||item.seq<1||item.seq>100000)continue;
   const review=reviewRapItem(item);
   if(!review.observations)continue;
   knownNotes.add(id);
   if(review.repeated)duplicateNotes.add(id);
   histories.push({id,seq:item.seq,stored:item.movements,cohort:review.repeated?'duplicate':'control'});
  }
 }
 histories.sort((a,b)=>(a.cohort==='duplicate'?0:1)-(b.cohort==='duplicate'?0:1)||
  a.id.localeCompare(b.id)||a.seq-b.seq);
 // Uma vaga de controle se houver, inclusive se a fila de repetidos for grande.
 const duplicates=histories.filter(x=>x.cohort==='duplicate');
 const controls=histories.filter(x=>x.cohort==='control');
 const chosen=duplicates.slice(0,historyLimit-(controls.length&&historyLimit>1?1:0));
 chosen.push(...controls.slice(0,historyLimit-chosen.length));
 const candidates=[];
 for(const [id,entries] of owners){
  if(entries.length!==1||!DOC.test(id))continue;
  const {doc,month}=entries[0];
  if(![2,3].includes(doc.phase)||Number(id.slice(11,15))<2024||
     (id.slice(15,17)==='NS'?2:3)!==doc.phase)continue;
  const links=(month.relations||[]).filter(l=>l.from===id&&scope(l.to)&&year(l.to)<year(id));
  if(!links.length)continue;
  const rank=links.some(l=>duplicateNotes.has(l.to))?0:links.some(l=>knownNotes.has(l.to))?1:2;
  candidates.push({id,phase:doc.phase,links,rank,
   cohort:rank===0?'linked_duplicate':rank===1?'linked_inscription':'other_interannual'});
 }
 candidates.sort((a,b)=>a.rank-b.rank||b.id.slice(11,15).localeCompare(a.id.slice(11,15))||a.id.localeCompare(b.id));
 const groups=[candidates.filter(x=>x.phase===2),candidates.filter(x=>x.phase===3)],impacts=[];
 while(impacts.length<impactLimit&&groups.some(x=>x.length)){
  for(const group of groups){if(group.length&&impacts.length<impactLimit)impacts.push(group.shift());}
 }
 return {histories:chosen,impacts,counts:{knownNotes:knownNotes.size,duplicateNotes:duplicateNotes.size,
  candidateHistories:histories.length,duplicateHistories:duplicates.length,
  selectedHistories:chosen.length,selectedDuplicateHistories:chosen.filter(x=>x.cohort==='duplicate').length,
  candidateImpactDocuments:candidates.length,selectedImpactDocuments:impacts.length}};
}

/** Captura linhas brutas somente em memória, e somente usa resultados após a
 * mesma validação e paginação completa da rotina regular. */
export async function auditTargetHistory(sample,{token,budget,request=getCguArray}={}){
 const raw=[];
 const result=await resolveItemMovements(sample.id,sample.seq,{token,budget,limit:4,
  request:async(id,seq,p,opts)=>{
   const rows=await request(historyUrl(id,seq,p),opts);
   if(Array.isArray(rows))raw.push(...rows);
   return rows;
  }});
 if(!result.ok)return {cohort:sample.cohort,status:'unavailable',reason:safeReason(result.reason)};
 const events=result.movements;
 const old=multiset(sample.stored),fresh=multiset(events);
 const groups=new Map();
 for(let i=0;i<events.length;i++){
  if(!isRapInscription(events[i]))continue;
  const signature=key(events[i]);
  if(!groups.has(signature))groups.set(signature,[]);
  groups.get(signature).push(raw[i]);
 }
 let duplicateGroups=0,rawIdenticalGroups=0,rawDifferentGroups=0,extraIdentityFieldGroups=0;
 for(const rows of groups.values()){
  if(rows.length<2)continue;
  duplicateGroups++;
  if(new Set(rows.map(rawKey)).size===1)rawIdenticalGroups++;
  else rawDifferentGroups++;
  if(candidateKeys.some(k=>new Set(rows.filter(r=>Object.hasOwn(r,k)&&r[k]!==null&&r[k]!=='')
    .map(r=>rawKey(r[k]))).size>1))extraIdentityFieldGroups++;
 }
 const sameUnique=old.size===fresh.size&&[...old.keys()].every(k=>fresh.has(k));
 return {cohort:sample.cohort,status:events.length?'complete':'empty',storedMovements:sample.stored.length,
  observedMovements:events.length,historyComparison:sameCounts(old,fresh)?'same_multiset':
   sameUnique?'changed_multiplicity':'changed_content',
  missingStoredSignatures:[...old.keys()].filter(k=>!fresh.has(k)).length,
  additionalSignatures:[...fresh.keys()].filter(k=>!old.has(k)).length,
  storedInscription:reviewRapItem({movements:sample.stored}),
  freshInscription:reviewRapItem({movements:events}),
  duplicateGroups,rawIdenticalGroups,rawDifferentGroups,extraIdentityFieldGroups,
  identityFields:identityFields(raw)};
}
const emptyFieldCounts=()=>Object.fromEntries(moneyKeys.map(k=>[k,{positive:0,zero:0,negative:0,unavailable:0}]));
export async function auditTargetImpact(sample,{token,budget,request}={}){
 const fn=sample.phase===2?resolveLiquidationLinks:resolvePaymentLinks;
 const outcome=await fn(sample.id,{token,budget,limit:4,includeRapComponents:true,...(request?{request}:{})});
 if(!outcome.ok)return {cohort:sample.cohort,phase:sample.phase,status:'unavailable',reason:safeReason(outcome.reason)};
 const expected=new Map(sample.links.map(l=>[l.to,l]));
 const fields=emptyFieldCounts();
 let matched=0,legacyMatches=0,legacyDifferences=0,repeated=0,additionalPriorPairs=0;
 for(const link of outcome.links){
  if(!scope(link.to)||year(link.to)>=year(sample.id))continue;
  const old=expected.get(link.to);
  if(!old){additionalPriorPairs++;continue;}
  matched++;
  if(old.cents===link.cents)legacyMatches++;else legacyDifferences++;
  const components=link.impactComponents;
  if(components?.repeatedRows)repeated++;
  for(const k of moneyKeys){
   const n=components?.[k];
   fields[k][!Number.isSafeInteger(n)?'unavailable':n>0?'positive':n<0?'negative':'zero']++;
  }
 }
 return {cohort:sample.cohort,phase:sample.phase,status:outcome.links.length?'complete':'empty',
  expectedPriorPairs:expected.size,matchedPriorPairs:matched,missingPriorPairs:expected.size-matched,
  additionalPriorPairs,legacyMatches,legacyDifferences,repeatedPairs:repeated,fields};
}
export function summarizeTargetAudits(histories,impacts){
 const out={histories:{attempted:histories.length,completed:0,unavailable:0,empty:0,
  sameMultiset:0,changedMultiplicity:0,changedContent:0,duplicateGroups:0,
  rawIdenticalGroups:0,rawDifferentGroups:0,extraIdentityFieldGroups:0,missingStoredSignatures:0,
  additionalSignatures:0,byCohort:{},reasons:{}},impacts:{attempted:impacts.length,
  completed:0,unavailable:0,empty:0,matchedPriorPairs:0,missingPriorPairs:0,additionalPriorPairs:0,
  legacyMatches:0,legacyDifferences:0,repeatedPairs:0,fields:emptyFieldCounts(),byPhase:{},reasons:{}}};
 for(const r of histories){
  const h=out.histories,c=h.byCohort[r.cohort]||={attempted:0,completed:0,unavailable:0,empty:0,
   repeatedInscriptionObservations:0};
  c.attempted++;
  if(r.status==='unavailable'){h.unavailable++;c.unavailable++;h.reasons[r.reason]=(h.reasons[r.reason]||0)+1;continue;}
  h.completed++;c.completed++;if(r.status==='empty'){h.empty++;c.empty++;}
  h[r.historyComparison==='same_multiset'?'sameMultiset':r.historyComparison==='changed_multiplicity'?'changedMultiplicity':'changedContent']++;
  for(const k of ['duplicateGroups','rawIdenticalGroups','rawDifferentGroups','extraIdentityFieldGroups','missingStoredSignatures','additionalSignatures'])h[k]+=r[k];
  c.repeatedInscriptionObservations+=r.freshInscription.repeated;
 }
 for(const r of impacts){
  const h=out.impacts,p=h.byPhase[r.phase]||={attempted:0,completed:0,unavailable:0,empty:0,fields:emptyFieldCounts()};
  p.attempted++;
  if(r.status==='unavailable'){h.unavailable++;p.unavailable++;h.reasons[r.reason]=(h.reasons[r.reason]||0)+1;continue;}
  h.completed++;p.completed++;if(r.status==='empty'){h.empty++;p.empty++;}
  for(const k of ['matchedPriorPairs','missingPriorPairs','additionalPriorPairs','legacyMatches','legacyDifferences','repeatedPairs'])h[k]+=r[k];
  for(const k of moneyKeys)for(const cat of Object.keys(h.fields[k])){
   h.fields[k][cat]+=r.fields[k][cat];p.fields[k][cat]+=r.fields[k][cat];
  }
 }
 return out;
}
async function main(){
 const root=process.cwd(),token=process.env.CGU_API_KEY;
 const manifest=validateManifest(JSON.parse(await readFile(join(root,'data/manifest.json'),'utf8')));
 const months=[];
 for(const month of manifest.months.filter(m=>m>='2024-01'))
  months.push(validateMonth(JSON.parse(await readFile(join(root,'data/months',month+'.json'),'utf8'))));
 const plan=planTargetedRap(months);
 console.log('Cobertura RAP canônica (somente contagens): '+JSON.stringify(summarizeRapEvidence(months)));
 console.log('Plano dirigido RAP (somente contagens): '+JSON.stringify(plan.counts));
 if(process.argv.includes('--dry-run'))return;
 if(!token)throw Error('CGU_API_KEY ausente');
 // Lote único, sem cron; todas as páginas e tentativas compartilham o limite.
 const budget=createCguBudget({requests:48,durationMs:4*60*1000,spacingMs:1500});
 const histories=[],impacts=[];
 // Alterna história e impacto para que uma fase não consuma toda a janela.
 for(let i=0;i<Math.max(plan.histories.length,plan.impacts.length);i++){
  if(plan.histories[i]&&!budget.stopped())histories.push(await auditTargetHistory(plan.histories[i],{token,budget}));
  if(plan.impacts[i]&&!budget.stopped())impacts.push(await auditTargetImpact(plan.impacts[i],{token,budget}));
 }
 console.log('Auditoria dirigida RAP (somente contagens): '+JSON.stringify(summarizeTargetAudits(histories,impacts)));
 console.log('Orçamento HTTP: '+JSON.stringify(budget.snapshot()));
 if(histories.length+impacts.length===0||(histories.every(x=>x.status==='unavailable')&&impacts.every(x=>x.status==='unavailable')))
  throw Error('Nenhuma consulta concluída');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main().catch(()=>{console.error('Auditoria dirigida RAP não concluída; dados preservados.');process.exitCode=1;});

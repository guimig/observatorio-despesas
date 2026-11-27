import {createCguBudget} from './cgu-budget.mjs';
import {FIRST_YEAR,inScopeNe} from './collection-scope.mjs';
import {readProcurement} from './procurement-store.mjs';
import {readCguContractEvidence} from './cgu-contract-evidence.mjs';
import {extractAraquariNeEvidence} from '../assets/procurement-links.js';
/**
 * Recupera por codigo completo NE do mesmo exercicio ou anterior ja referenciada
 * por NS/OB/DF canonicos. A consulta individual NAO cobre o dia/mes inteiro.
 * Nenhum corpo bruto, token, ID, valor ou favorecido e impresso no runner.
 */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeDocument} from './cgu.mjs';
import {detailUrl} from './inspect-cgu-siafi.mjs';
import {persistTargetedOriginal,persistTargetedDocument,validateManifest,validateMonth,validatePublishedData}
 from './store.mjs';
import {inScopeRelatedDocument,validRelatedPair} from '../assets/trajectory.js';
import {stateKey,readOperationalState,saveOperationalState,validDay} from './operational-state.mjs';

const NOTE=/^158459\d{5}(20\d{2})NE\d{6}$/;
const PARENT=/^158459\d{5}(20\d{2})(NS|OB|DF)\d{6}$/;
const PHASE={NS:2,OB:3,DF:3};
const MAX_BYTES=262144;
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const validIso=value=>{
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))
   return false;
 const timestamp=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(timestamp)&&
   new Date(timestamp).toISOString().slice(0,10)===value;
};
function dateFromSource(value){
 if(typeof value!=='string')return null;
 const trimmed=value.trim();
 let date=null,match;
 if((match=/^(20\d{2}-\d{2}-\d{2})(?:[T\s]|$)/.exec(trimmed)))
   date=match[1];
 else if((match=/^(\d{2})\/(\d{2})\/(20\d{2})(?:[T\s]|$)/.exec(trimmed)))
   date=match[3]+'-'+match[2]+'-'+match[1];
 return validIso(date)?date:null;
}
/** Apenas classes derivadas de campos fixos, nunca valores ou datas da CGU. */
export function summarizeOriginalIssueFields(id,payload,{now=new Date()}={}){
 if(!NOTE.test(id)||!payload||typeof payload!=='object'||
    Array.isArray(payload)||!(now instanceof Date)||
    !Number.isFinite(now.getTime()))throw coded('detail_invalid');
 const expectedYear=NOTE.exec(id)[1],latest=dayBeforeToday(now);
 const classify=value=>{
   if(value===undefined||value===null||value==='')return 'not_provided';
   const parsed=dateFromSource(value);
   if(!parsed)return 'invalid_or_unknown';
   if(parsed>latest)return 'future';
   if(parsed.slice(0,4)<expectedYear)return 'before_ne_year';
   if(parsed.slice(0,4)>expectedYear)return 'after_ne_year';
   return 'same_ne_year';
 };
 const data=dateFromSource(payload.data);
 const emission=dateFromSource(payload.dataEmissao);
 const docDate=dateFromSource(payload.dataDocumento);
 const phase=typeof payload.fase==='string'?payload.fase.trim().toLowerCase()
   .normalize('NFD').replace(/[\u0300-\u036f]/g,''):payload.fase;
 return {
   identityConfirmed:payload.documento===id&&String(payload.codigoUg)==='158459',
   phaseConfirmed:[1,'1','empenho','empenhos','1 - empenho'].includes(phase),
   dateClasses:{
     data:classify(payload.data),
     dataEmissao:classify(payload.dataEmissao),
     dataDocumento:classify(payload.dataDocumento)
   },
   dataMatchesEmissao:data&&emission?data===emission:null,
   dataMatchesDocumento:data&&docDate?data===docDate:null,
   caution:'Classificacao de data nao prova emissao; nenhum campo alternativo foi incorporado'
 };
}
function dayBeforeToday(now){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
   timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(now).map(p=>[p.type,p.value]));
 const local=parts.year+'-'+parts.month+'-'+parts.day;
 return new Date(Date.parse(local+'T00:00:00Z')-86400000)
   .toISOString().slice(0,10);
}

/** Selecao somente de relacoes estruturadas NS/OB/DF -> NE. */
export function missingReferencedNe(sources,{scope='interannual',contracts=[],cguContracts=[]}={}){
 if(!['interannual','same_year','all'].includes(scope))throw Error('Escopo NE invalido');
 if(!Array.isArray(sources))throw Error('Acervo de origem invalido');
 const originals=new Set(),owners=new Map(),relations=[],identityPairs=[];
 for(const month of sources){
   if(!Array.isArray(month?.documents)||!Array.isArray(month?.relations))
     throw Error('Acervo de origem invalido');
   for(const doc of month.documents){
     if(doc.phase===1&&NOTE.test(doc.id))originals.add(doc.id);
     if(PARENT.test(doc.id))for(const target of doc.relatedIds||[])if(inScopeNe(target))identityPairs.push({from:doc.id,to:target});
     if(PARENT.test(doc.id)&&PHASE[PARENT.exec(doc.id)[2]]===doc.phase){
       const existing=owners.get(doc.id);
       if(existing&&existing.date!==doc.date)
         throw Error('Origem de impacto divergente no acervo');
       owners.set(doc.id,{year:Number(PARENT.exec(doc.id)[1]),phase:doc.phase,date:doc.date});
     }
   }
   for(const rel of month.relations)relations.push(rel);
 }
 const targets=new Set();
 for(const row of [...relations,...identityPairs]){
   const year=NOTE.exec(row?.to||''),from=PARENT.exec(row?.from||'');
   const owner=owners.get(row?.from);
   if(!year||!from||!owner||originals.has(row.to)||!inScopeNe(row.to)||owner.year<FIRST_YEAR)continue;
   const targetYear=Number(year[1]);
   if((scope!=='same_year'&&owner.year>targetYear)||
      (scope!=='interannual'&&owner.year===targetYear))targets.add(row.to);
 }
 if(scope==='all')for(const c of contracts){
  if(c.source!=='pncp')continue;
  for(const raw of [c.number,...(c.commitmentRefs||[])]){const ev=extractAraquariNeEvidence(raw);if(ev?.kind==='full'&&inScopeNe(ev.ne)&&!originals.has(ev.ne))targets.add(ev.ne);}
 }
 if(scope==='all')for(const c of cguContracts)for(const ne of c.refs||[])if(inScopeNe(ne)&&!originals.has(ne))targets.add(ne);
 return [...targets].sort((a,b)=>a.slice(11,15).localeCompare(b.slice(11,15))||
   a.localeCompare(b));
}
/** Identidade de origem financeira ausente, declarada pela NE de contrato CGU
 * inequivoco. Nunca usar valor documental ou presumir relacao NS -> OB. */
export function missingContractFinancialDocuments(months,cguContracts=[]){
 const refs=new Map(),docs=new Map(),targets=new Set();
 for(const c of cguContracts)for(const ne of new Set(c.refs||[]))if(inScopeNe(ne))refs.set(ne,(refs.get(ne)||0)+1);
 for(const m of months)for(const d of m.documents){
  if(!docs.has(d.id))docs.set(d.id,[]);
  docs.get(d.id).push(d);
 }
 for(const [id,count] of refs){
  const found=docs.get(id);
  if(count!==1||found?.length!==1||found[0].phase!==1)continue;
  for(const other of found[0].relatedIds||[])
   if(validRelatedPair(id,other)&&PARENT.test(other)&&!docs.has(other))targets.add(other);
 }
 return [...targets].sort();
}
export function chooseNeBatch(targets,{limit=3,slot=0}={}){
 if(!Array.isArray(targets)||targets.some(id=>!inScopeNe(id))||
   new Set(targets).size!==targets.length||
   !Number.isSafeInteger(limit)||limit<1||limit>15||
   !Number.isSafeInteger(slot)||slot<0)throw Error('Plano NE invalido');
 const ordered=[...targets].sort((a,b)=>a.slice(11,15).localeCompare(b.slice(11,15))||
    a.localeCompare(b));
 if(!ordered.length)return [];
 const groups=Math.ceil(ordered.length/limit);
 const offset=(slot%groups)*limit;
 return ordered.slice(offset,offset+limit);
}

/** Falha fechada se data, UG, fase ou identidade do retorno nao coincidem. */
export function normalizeOriginalDetail(id,payload,{now=new Date()}={}){
 if(!NOTE.test(id)||!payload||typeof payload!=='object'||
    Array.isArray(payload)||!(now instanceof Date)||
    !Number.isFinite(now.getTime()))throw coded('detail_invalid');
 if(payload.documento!==id||String(payload.codigoUg)!=='158459')
   throw coded('identity_mismatch');
 const phase=typeof payload.fase==='string'?payload.fase.trim().toLowerCase()
   .normalize('NFD').replace(/[\u0300-\u036f]/g,''):payload.fase;
 if(![1,'1','empenho','empenhos','1 - empenho'].includes(phase))
   throw coded('phase_unverified');
 const issued=dateFromSource(payload.data);
 if(!issued||issued.slice(0,4)!==NOTE.exec(id)[1]||
    issued>dayBeforeToday(now))
   throw coded('issue_date_unverified');
 if(payload.dataEmissao!==undefined&&
   dateFromSource(payload.dataEmissao)!==issued)
   throw coded('issue_date_conflict');
 const [year,month,day]=issued.split('-');
 const br=day+'/'+month+'/'+year;
 let doc;
 try{doc=normalizeDocument(payload,br,1);}
 catch{throw coded('normalization_invalid');}
 if(doc.id!==id||doc.date!==issued||doc.phase!==1)
   throw coded('normalization_mismatch');
 return doc;
}
/** Recupera documento de outra fase apenas se identidade, fase e data forem
 * verificadas no detalhe oficial; nenhum valor vira impacto automaticamente. */
export function normalizeRelatedFinancialDetail(id,payload,{now=new Date()}={}){
 const type=PARENT.exec(id||'')?.[2],expected=PHASE[type];
 if(!inScopeRelatedDocument(id)||!expected||!payload||typeof payload!=='object'||Array.isArray(payload))
  throw coded('detail_invalid');
 if(payload.documento!==id||String(payload.codigoUg)!=='158459')throw coded('identity_mismatch');
 const phase=typeof payload.fase==='string'?payload.fase.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''):payload.fase;
 const accepted=expected===2?[2,'2','liquidacao','liquidacoes','2 - liquidacao']:[3,'3','pagamento','pagamentos','3 - pagamento'];
 if(!accepted.includes(phase))throw coded('phase_unverified');
 const date=dateFromSource(payload.data);
 if(!date||date.slice(0,4)!==id.slice(11,15)||date>dayBeforeToday(now))throw coded('issue_date_unverified');
 if(payload.dataEmissao!==undefined&&dateFromSource(payload.dataEmissao)!==date)throw coded('issue_date_conflict');
 let doc;
 try{doc=normalizeDocument(payload,date.split('-').reverse().join('/'),expected);}
 catch{throw coded('normalization_invalid');}
 if(doc.id!==id||doc.date!==date||doc.phase!==expected)throw coded('normalization_mismatch');
 return doc;
}
function categorize(error){
 const status=Number(error?.status);
 if(Number.isInteger(status)&&status>=400&&status<=599)
   return status===404?'http_404':status===401||status===403?
     'authentication_required':status===429?'rate_limited':status>=500?
       'source_unavailable':'http_other';
 const code=error?.code;
 if(['invalid_shape','too_large','network','invalid_json',
   'detail_invalid','identity_mismatch','phase_unverified',
   'issue_date_unverified','issue_date_conflict',
   'normalization_invalid','normalization_mismatch'].includes(code))
   return code;
 // Categorias literais, nunca nomes de pessoas/IDs/valores da resposta.
 if(error?.message==='Dia CGU ja completo sem NE individual: revisar fonte')
   return 'coverage_conflict';
 return 'validation_or_network';
}
function coded(reason){const e=Error('Consulta individual CGU indisponivel');e.code=reason;return e;}

/** Le no maximo 256 KiB, inclusive se content-length nao foi informado. */
async function parseBounded(response){
 const declared=Number(response.headers?.get?.('content-length'));
 if(Number.isFinite(declared)&&declared>MAX_BYTES){
   await response.body?.cancel?.().catch(()=>{});
   throw coded('too_large');
 }
 if(!response.body?.getReader)throw coded('invalid_shape');
 const reader=response.body.getReader(),chunks=[];
 let bytes=0;
 try{
   for(;;){
     const {done,value}=await reader.read();
     if(done)break;
     bytes+=value.length;
     if(bytes>MAX_BYTES){await reader.cancel();throw coded('too_large');}
     chunks.push(value);
   }
   const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!payload||typeof payload!=='object'||Array.isArray(payload))
     throw coded('invalid_shape');
   return payload;
 }catch(error){
   if(error?.code==='too_large'||error?.code==='invalid_shape')throw error;
   throw coded('invalid_json');
 }
}
export async function fetchCguOriginal(id,options={}){
 if(!inScopeNe(id))throw Error('Consulta CGU nao autorizada');
 return fetchCguDocumentDetail(id,options);
}
export async function fetchCguDocumentDetail(id,{
 token,fetchFn=fetch,wait=delay,timeoutMs=18000,budget
}={}){
 if(!inScopeRelatedDocument(id)||typeof token!=='string'||!token||
   !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
   throw Error('Consulta CGU nao autorizada');
 const url=detailUrl(id);
 for(let attempt=0;attempt<2;attempt++){
   if(budget)await budget.beforeRequest();
   let res;
   try{
     res=await fetchFn(url,{headers:{
       Accept:'application/json','chave-api-dados':token
     },redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
   }catch{
     budget?.observe(null);
     if(attempt===0&&!budget?.stopped()){await wait(1000);continue;}
     throw coded('network');
   }
   budget?.observe(res.status);
   if([429,500,502,503,504].includes(res.status)&&attempt===0&&!budget?.stopped()){
     try{await res.body?.cancel?.();}catch{}
     await wait(1500);
     continue;
   }
   if(!res.ok){
     const e=Error('CGU HTTP '+res.status);
     e.status=res.status;
     try{await res.body?.cancel?.();}catch{}
     throw e;
   }
   return parseBounded(res);
 }
 throw coded('network');
}
async function readSources(root){
 const manifest=validateManifest(JSON.parse(await readFile(
   join(root,'data','manifest.json'),'utf8')));
 return Promise.all(manifest.months.map(async month=>
   validateMonth(JSON.parse(await readFile(
     join(root,'data','months',month+'.json'),'utf8')))));
}
const byYear=targets=>targets.reduce((obj,id)=>{
 const year=id.slice(11,15);
 obj[year]=(obj[year]||0)+1;
 return obj;
},{});
/**
 * Cada resposta valida e gravada separadamente. Erro individual preserva os
 * outros; nunca marca um dia completo ou cria saldo/inscricao de RP.
 */
export async function recoverReferencedNe({
 root=process.cwd(),token,now=new Date(),limit=3,slot=0,
 year=null,scope='interannual',dryRun=false,fetchFn=fetch,wait=delay,persist=persistTargetedOriginal,persistFinancial=persistTargetedDocument,budget,statePath
}={}){
 if(year!==null&&(typeof year!=='string'||!/^20\d{2}$/.test(year)||Number(year)<FIRST_YEAR))
   throw Error('Exercicio CGU de destino invalido');
 const months=await readSources(root);
 const contracts=scope==='all'?(await readProcurement(root))?.contracts||[]:[];
 const cguContracts=scope==='all'?(await readCguContractEvidence(root)).contracts:[];
 const missing=missingReferencedNe(months,{scope,contracts,cguContracts});
 const eligible=year===null?missing:missing.filter(id=>id.slice(11,15)===year);
 const state=await readOperationalState(statePath,{now});
 const today=now.toISOString().slice(0,10);
 const attemptKey=id=>stateKey(['cgu-original-retry-v1',id]);
 const due=id=>{const stamp=state[attemptKey(id)];return !validDay(stamp)||stamp>today||Date.parse(today)-Date.parse(stamp)>=2*86400000};
 const financial=scope==='all'&&year===null?missingContractFinancialDocuments(months,cguContracts):[];
 // Compartilhar as mesmas vagas e o mesmo orçamento de HTTP, sem ampliar lote.
 const dueNe=eligible.filter(due),dueFinancial=financial.filter(due);
 if(!Number.isSafeInteger(limit)||limit<1||limit>15||!Number.isSafeInteger(slot)||slot<0)throw Error('Plano NE invalido');
 const financialQuota=dueFinancial.length?Math.min(dueFinancial.length,dueNe.length?Math.max(1,Math.floor(limit/3)):limit):0;
 const selectFinancial=dueFinancial.length?dueFinancial.slice((slot*financialQuota)%dueFinancial.length).concat(dueFinancial.slice(0,(slot*financialQuota)%dueFinancial.length)).slice(0,financialQuota):[];
 const neSlots=limit-selectFinancial.length;
 const declared=new Set(cguContracts.flatMap(c=>c.refs||[]));
 const priority=dueNe.filter(id=>declared.has(id));
 const reserved=neSlots&&priority.length?chooseNeBatch(priority,{limit:Math.min(neSlots,Math.max(1,Math.ceil(neSlots/2))),slot}):[];
 const rest=dueNe.filter(id=>!reserved.includes(id));
 const remaining=neSlots-reserved.length;
 const selected=reserved.concat(remaining?chooseNeBatch(rest,{limit:remaining,slot}):[],selectFinancial);
 const output={status:dryRun?'dry_run':'complete',scope,missing:missing.length,
   missingByYear:byYear(missing),eligible:eligible.length,
   selected:byYear(selected),attempted:0,
   recovered:0,unchanged:0,failures:{},financialMissing:financial.length,financialSelected:selectFinancial.length,financialRecovered:0,deferred:eligible.length-dueNe.length+financial.length-dueFinancial.length};
 if(!dryRun&&!selected.length&&(missing.length||financial.length))output.status='no_eligible';
 if(dryRun||!selected.length)return output;
 if(!token||typeof token!=='string')throw Error('CGU_API_KEY ausente');
 for(const id of selected){
   if(budget?.stopped())break;
   output.attempted++;
   try{
     const isFinancial=!inScopeNe(id);
     const raw=await fetchCguDocumentDetail(id,{token,fetchFn,wait,budget});
     const doc=isFinancial?normalizeRelatedFinancialDetail(id,raw,{now}):normalizeOriginalDetail(id,raw,{now});
     const result=await (isFinancial?persistFinancial:persist)(root,doc,now);
     if(result.changed){output.recovered++;if(isFinancial)output.financialRecovered++;}
     else output.unchanged++;
     delete state[attemptKey(id)];
   }catch(error){
     const reason=categorize(error);
     output.failures[reason]=(output.failures[reason]||0)+1;
     if(statePath&&!budget?.stopped())state[attemptKey(id)]=today;
   }
 }
 if(budget)output.telemetry=budget.snapshot();
 if(persist===persistTargetedOriginal&&persistFinancial===persistTargetedDocument)
   await validatePublishedData(root);
 await saveOperationalState(statePath,state,{now});
 if(Object.keys(output.failures).length)output.status='partial';
 return output;
}
/**
 * Uma unica NE de 2024 em aberto, consultada somente para classificar
 * a relacao de seus campos de data com o ano do codigo SIAFI.
 * Nenhuma resposta, identificador, data exata ou documento e salvo.
 */
export async function diagnoseOldestIssueDate({
 root=process.cwd(),token,now=new Date(),fetchFn=fetch,wait=delay
}={}){
 const missing=missingReferencedNe(await readSources(root));
 const candidates=missing.filter(id=>id.slice(11,15)==='2024');
 if(!candidates.length)return {status:'no_2024_pending',sampled:0};
 if(!token||typeof token!=='string')throw Error('CGU_API_KEY ausente');
 try{
   const payload=await fetchCguOriginal(candidates[0],{token,fetchFn,wait});
   return {status:'observed',sampled:1,
     ...summarizeOriginalIssueFields(candidates[0],payload,{now})};
 }catch(error){
   return {status:'unavailable',sampled:1,reason:categorize(error)};
 }
}
async function main(){
 try{
   if(process.argv.includes('--diagnose-oldest')){
     const diagnostic=await diagnoseOldestIssueDate({
       root:resolve(process.cwd()),token:process.env.CGU_API_KEY
     });
     console.log('Diagnostico CGU de NE 2024 (somente classes): '+
       JSON.stringify(diagnostic));
     return;
   }
   const max=Number(process.env.CGU_ORIGINAL_LIMIT??3);
   const slot=process.env.CGU_ORIGINAL_SLOT===undefined||
     process.env.CGU_ORIGINAL_SLOT===''?
       Math.floor(Date.now()/43200000):Number(process.env.CGU_ORIGINAL_SLOT);
   const selectedYear=process.env.CGU_ORIGINAL_YEAR;
   const year=!selectedYear||selectedYear==='all'?null:selectedYear;
   const result=await recoverReferencedNe({root:resolve(process.cwd()),
     token:process.env.CGU_API_KEY,limit:max,slot,year,budget:createCguBudget({requests:30}),
     scope:process.env.CGU_ORIGINAL_SCOPE||'interannual',statePath:process.env.CGU_ORIGINAL_STATE_PATH,
     dryRun:process.argv.includes('--dry-run')});
   console.log('NEs referenciadas: '+JSON.stringify(result)+
     '. Consulta individual nao equivale a cobertura diaria, RP inscrito ou saldo.');
   // Falhas de API sem novos documentos mantem a fila; um problema de esquema
   // nunca deve ser disfarçado de cobertura integral.
   if(result.status==='partial'&&!result.recovered)process.exitCode=1;
 }catch{
   console.error('Recuperacao CGU de NEs interrompida; verificar esquema e autenticação.');
   process.exitCode=1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main();

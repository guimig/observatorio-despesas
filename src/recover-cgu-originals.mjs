import {createCguBudget} from './cgu-budget.mjs';
import {FIRST_YEAR,inScopeNe} from './collection-scope.mjs';
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
import {persistTargetedOriginal,validateManifest,validateMonth,validatePublishedData}
 from './store.mjs';

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
export function missingReferencedNe(sources,{scope='interannual'}={}){
 if(!['interannual','same_year','all'].includes(scope))throw Error('Escopo NE invalido');
 if(!Array.isArray(sources))throw Error('Acervo de origem invalido');
 const originals=new Set(),owners=new Map(),relations=[];
 for(const month of sources){
   if(!Array.isArray(month?.documents)||!Array.isArray(month?.relations))
     throw Error('Acervo de origem invalido');
   for(const doc of month.documents){
     if(doc.phase===1&&NOTE.test(doc.id))originals.add(doc.id);
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
 for(const row of relations){
   const year=NOTE.exec(row?.to||''),from=PARENT.exec(row?.from||'');
   const owner=owners.get(row?.from);
   if(!year||!from||!owner||originals.has(row.to)||!inScopeNe(row.to)||owner.year<FIRST_YEAR)continue;
   const targetYear=Number(year[1]);
   if((scope!=='same_year'&&owner.year>targetYear)||
      (scope!=='interannual'&&owner.year===targetYear))targets.add(row.to);
 }
 return [...targets].sort((a,b)=>a.slice(11,15).localeCompare(b.slice(11,15))||
   a.localeCompare(b));
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
export async function fetchCguOriginal(id,{
 token,fetchFn=fetch,wait=delay,timeoutMs=18000,budget
}={}){
 if(!inScopeNe(id)||typeof token!=='string'||!token||
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
 year=null,scope='interannual',dryRun=false,fetchFn=fetch,wait=delay,persist=persistTargetedOriginal,budget
}={}){
 if(year!==null&&(typeof year!=='string'||!/^20\d{2}$/.test(year)||Number(year)<FIRST_YEAR))
   throw Error('Exercicio CGU de destino invalido');
 const months=await readSources(root);
 const missing=missingReferencedNe(months,{scope});
 const eligible=year===null?missing:missing.filter(id=>id.slice(11,15)===year);
 const selected=chooseNeBatch(eligible,{limit,slot});
 const output={status:dryRun?'dry_run':'complete',scope,missing:missing.length,
   missingByYear:byYear(missing),eligible:eligible.length,
   selected:byYear(selected),attempted:0,
   recovered:0,unchanged:0,failures:{}};
 if(!dryRun&&!selected.length&&missing.length)output.status='no_eligible';
 if(dryRun||!selected.length)return output;
 if(!token||typeof token!=='string')throw Error('CGU_API_KEY ausente');
 for(const id of selected){
   if(budget?.stopped())break;
   output.attempted++;
   try{
     const raw=await fetchCguOriginal(id,{token,fetchFn,wait,budget});
     const doc=normalizeOriginalDetail(id,raw,{now});
     const result=await persist(root,doc,now);
     if(result.changed)output.recovered++;
     else output.unchanged++;
   }catch(error){
     const reason=categorize(error);
     output.failures[reason]=(output.failures[reason]||0)+1;
   }
 }
 if(budget)output.telemetry=budget.snapshot();
 if(persist===persistTargetedOriginal)
   await validatePublishedData(root);
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
     scope:process.env.CGU_ORIGINAL_SCOPE||'interannual',
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

/**
 * Diagnostico pontual da unica NE interanual de 2024 sem origem local.
 * Compara o detalhe CGU com a consulta oficial por favorecido + ANO
 * de emissao, UG 158459 e fase Empenho. Ano nao equivale ao dia da emissao.
 * Nunca salva payloads, CNPJ, identificador, data exata, valores ou textos.
 */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {missingReferencedNe,fetchCguOriginal,
  summarizeOriginalIssueFields} from './recover-cgu-originals.mjs';
import {validateManifest,validateMonth} from './store.mjs';

const BASE='https://api.portaldatransparencia.gov.br/api-de-dados/despesas';
const NE=/^158459\d{5}(20\d{2})NE\d{6}$/;
const CNPJ=/^\d{14}$/;
const MAX_PAGES=4,MAX_ROWS=200,MAX_BYTES=384*1024;

const samePhase=value=>{
  if(value===1||value==='1')return true;
  if(typeof value!=='string')return false;
  const phase=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .trim().toLowerCase();
  return ['empenho','empenhos','1 - empenho'].includes(phase);
};
const cnpjFromSource=value=>{
  if(typeof value!=='string')return null;
  const trimmed=value.trim();
  if(!/^[0-9.\-/ ]{14,22}$/.test(trimmed))return null;
  const digits=trimmed.replace(/\D/g,'');
  return CNPJ.test(digits)?digits:null;
};
const dateYear=value=>{
  if(typeof value!=='string')return null;
  const raw=value.trim();
  const iso=/^(20\d{2})-(\d{2})-(\d{2})(?:T|\s|$)/.exec(raw);
  const br=/^(\d{2})\/(\d{2})\/(20\d{2})(?:T|\s|$)/.exec(raw);
  let date;
  if(iso)date=[iso[1],iso[2],iso[3]].join('-');
  else if(br)date=[br[3],br[2],br[1]].join('-');
  if(!date)return null;
  const t=Date.parse(date+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===date?
    date.slice(0,4):null;
};
const classifyDate=(value,year)=>{
  if(value===undefined||value===null||value==='')return 'not_provided';
  const observed=dateYear(value);
  if(!observed)return 'unparseable';
  return observed===year?'same_ne_year':
    observed>year?'after_ne_year':'before_ne_year';
};
function safeError(error){
  const status=Number(error?.status);
  if(status===401||status===403)return 'authentication_required';
  if(status===404)return 'http_404';
  if(status===429)return 'rate_limited';
  if(Number.isSafeInteger(status)&&status>=500&&status<600)
    return 'source_unavailable';
  if(Number.isSafeInteger(status)&&status>=400&&status<500)
    return 'http_other';
  return ['too_large','invalid_json','invalid_shape','network'].includes(error?.code)?
    error.code:'source_unavailable';
}
function coded(code,status=null){
 const error=Error('CGU consulta controlada nao concluida');
 error.code=code;
 if(status!==null)error.status=status;
 return error;
}
async function readBoundedJsonArray(response){
 if(!response?.body?.getReader)throw coded('invalid_shape');
 const declared=Number(response.headers?.get?.('content-length'));
 if(Number.isFinite(declared)&&declared>MAX_BYTES){
   await response.body.cancel().catch(()=>{});
   throw coded('too_large');
 }
 const reader=response.body.getReader(),chunks=[];
 let length=0;
 try{
   for(;;){
     const {done,value}=await reader.read();
     if(done)break;
     length+=value.length;
     if(length>MAX_BYTES){
       await reader.cancel().catch(()=>{});
       throw coded('too_large');
     }
     chunks.push(value);
   }
 }catch(error){
   if(error?.code==='too_large')throw error;
   throw coded('network');
 }
 let payload;
 try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{throw coded('invalid_json');}
 if(!Array.isArray(payload))throw coded('invalid_shape');
 return payload;
}
/** O codigoPessoa nunca vai para logs; somente CNPJ publico e permitido. */
export function beneficiaryYearUrl(cnpj,year,page=1){
 if(!CNPJ.test(cnpj)||!/^20\d{2}$/.test(year)||
   !Number.isSafeInteger(page)||page<1||page>MAX_PAGES)
   throw Error('Parametros controlados de consulta CGU invalidos');
 const params=new URLSearchParams({
   codigoPessoa:cnpj,fase:'1',ano:year,ug:'158459',pagina:String(page)
 });
 return BASE+'/documentos-por-favorecido?'+params.toString();
}
/** Cada pagina recebe timeout proprio e nao tem retries automaticos. */
export async function requestBeneficiaryYearPage(cnpj,year,page,{
 token,fetchFn=fetch,timeoutMs=14000
}={}){
 const url=beneficiaryYearUrl(cnpj,year,page);
 if(typeof token!=='string'||!token||
   !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>20000)
   throw Error('Acesso CGU nao autorizado');
 let response;
 try{
   response=await fetchFn(url,{headers:{
     Accept:'application/json','chave-api-dados':token
   },redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
 }catch{throw coded('network');}
 if(!response?.ok){
   const status=Number(response?.status)||0;
   try{await response?.body?.cancel?.();}catch{}
   throw coded('http_error',status);
 }
 return readBoundedJsonArray(response);
}
/** Match exato na API por ano; nunca converte em data original de emissao. */
export async function checkBeneficiaryYear(id,cnpj,{
 token,requestPage=requestBeneficiaryYearPage,maxPages=MAX_PAGES
}={}){
 if(!NE.test(id)||!CNPJ.test(cnpj)||
   !Number.isSafeInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES)
   throw Error('Identidade CGU de consulta anual invalida');
 const year=NE.exec(id)[1],pages=new Set();
 let rowsExamined=0;
 for(let page=1;page<=maxPages;page++){
   let rows;
   try{rows=await requestPage(cnpj,year,page,{token});}
   catch(error)return {status:'unavailable',reason:safeError(error),
     pagesConsulted:page,rowsExamined,yearConfirmed:false};
   if(!Array.isArray(rows)||rows.length>MAX_ROWS||
      rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))
     return {status:'invalid_page',pagesConsulted:page,rowsExamined,
       yearConfirmed:false};
   if(!rows.length)return {status:'complete_no_match',
     pagesConsulted:page,rowsExamined,yearConfirmed:false};
   const fingerprint=JSON.stringify(rows.map(row=>
     [row.documento,row.codigoUg,row.fase]));
   if(pages.has(fingerprint))return {status:'repeated_page',
     pagesConsulted:page,rowsExamined,yearConfirmed:false};
   pages.add(fingerprint);
   rowsExamined+=rows.length;
   const same=rows.filter(row=>row.documento===id);
   if(same.length){
     if(same.length!==1||same.some(row=>String(row.codigoUg)!=='158459'||
        !samePhase(row.fase)))
       return {status:'identity_conflict',pagesConsulted:page,
         rowsExamined,yearConfirmed:false};
     return {status:'exact_match_in_year_filter',
       pagesConsulted:page,rowsExamined,yearConfirmed:true,
       returnedDataClass:classifyDate(same[0].data,year),
       returnedEmissionClass:classifyDate(same[0].dataEmissao,year)};
   }
 }
 return {status:'pagination_incomplete',pagesConsulted:maxPages,
   rowsExamined,yearConfirmed:false};
}
async function readMonths(root){
 const manifest=validateManifest(JSON.parse(await readFile(
   join(root,'data/manifest.json'),'utf8')));
 return Promise.all(manifest.months.map(async month=>
   validateMonth(JSON.parse(await readFile(
     join(root,'data/months',month+'.json'),'utf8')))));
}
/** Diagnostico de no maximo uma NE, sem gravacao de dados/publicacao. */
export async function diagnoseBeneficiaryYear2024({
 root=process.cwd(),token,sources=null,
 fetchDetail=fetchCguOriginal,requestPage=requestBeneficiaryYearPage
}={}){
 const months=sources??await readMonths(root);
 const missing=missingReferencedNe(months)
   .filter(id=>NE.exec(id)?.[1]==='2024');
 if(!missing.length)return {status:'no_pending',pending:0};
 if(missing.length!==1)return {status:'ambiguous',pending:missing.length};
 if(typeof token!=='string'||!token)
   return {status:'credential_unavailable',pending:1};
 const id=missing[0];
 let payload,meta;
 try{payload=await fetchDetail(id,{token});}
 catch(error)return {status:'detail_unavailable',pending:1,
   reason:safeError(error)};
 try{meta=summarizeOriginalIssueFields(id,payload);}
 catch{return {status:'detail_invalid',pending:1};}
 if(!meta.identityConfirmed||!meta.phaseConfirmed)
   return {status:'identity_unverified',pending:1};
 const cnpj=cnpjFromSource(payload.codigoFavorecido);
 if(!cnpj)return {status:'beneficiary_cnpj_unavailable',pending:1,
   detailDataClass:meta.dateClasses.data};
 const probe=await checkBeneficiaryYear(id,cnpj,{token,requestPage});
 return {status:'observed',pending:1,
   detailDataClass:meta.dateClasses.data,
   byEmissionYear:probe,
   originRecorded:false,
   caution:'Filtro por ano da API CGU nao prova dia da emissao. Nenhum documento foi incorporado.'};
}
async function main(){
 try{
   const result=await diagnoseBeneficiaryYear2024({
     root:resolve(process.cwd()),token:process.env.CGU_API_KEY
   });
   console.log('Contraprova por exercicio CGU (sem ID, CNPJ ou data): '+
     JSON.stringify(result));
 }catch{
   console.error('Consulta anual CGU inconclusiva; nenhum documento alterado.');
   process.exitCode=1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main();

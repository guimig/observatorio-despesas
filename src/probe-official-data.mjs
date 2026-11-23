/**
 * Sondagem efemera de pequena janela PNCP e disponibilidade Contratos.gov.br.
 * Leitura apenas: sem token, escrita, snapshots ou log de payload/documentos.
 * NENHUMA relacao NS -> pagamento, saldo RAP ou vinculo financeiro inferido.
 */
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {API_CATALOG,summarizeOpenApi} from './probe-official-apis.mjs';

const PNCP='https://pncp.gov.br/api/consulta/v1/';
const CONTRACTS='https://contratos.comprasnet.gov.br';
const REITORIA='10635424000186';
const NE=/^158459\d{5}20\d{2}NE\d{6}$/;
const PNCP_ID=/^10635424000186-2-\d{6}\/20\d{2}$/;
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
const MAX_BYTES=3*1024*1024;
const PAGE_SIZE=10;
const MAX_PAGES=2;
const PROBES=Object.freeze([
  {kind:'contratos_atualizacao',path:'contratos/atualizacao'},
  {kind:'instrumentos_inclusao',path:'instrumentoscobranca/inclusao'}
]);

function isoDate(value){
 if(typeof value!=='string'||!ISO.test(value))return false;
 const d=new Date(value+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
export function pncpProbeUrl(kind,initial,final,page=1){
 const item=PROBES.find(p=>p.kind===kind);
 if(!item||!isoDate(initial)||!isoDate(final)||initial>final||
   (Date.parse(final)-Date.parse(initial))/86400000>30||
   !Number.isSafeInteger(page)||page<1||page>MAX_PAGES)
   throw Error('Parametros PNCP nao autorizados');
 const qs=new URLSearchParams({dataInicial:initial.replaceAll('-',''),
   dataFinal:final.replaceAll('-',''),cnpjOrgao:REITORIA,
   pagina:String(page),tamanhoPagina:String(PAGE_SIZE)});
 return PNCP+item.path+'?'+qs.toString();
}
function failure(status){
 if(status===401||status===403)return 'authentication_required';
 if(status===429)return 'rate_limited';
 if(Number.isInteger(status)&&status>=400&&status<=599)return 'http_'+status;
 return 'network_unavailable';
}
/** A coleta e limitada mesmo quando o servidor ignora content-length. */
async function boundedResponse(response){
 if(!response?.ok){
   try{await response?.body?.cancel();}catch{}
   return {status:failure(response?.status)};
 }
 const size=Number(response.headers?.get('content-length'));
 if(Number.isFinite(size)&&size>MAX_BYTES){
   try{await response.body?.cancel();}catch{}
   return {status:'response_too_large'};
 }
 if(!response.body||typeof response.body.getReader!=='function')
   return {status:'invalid_body'};
 const reader=response.body.getReader(),chunks=[];
 let total=0;
 try{
   for(;;){
     const {done,value}=await reader.read();
     if(done)break;
     total+=value.length;
     if(total>MAX_BYTES){await reader.cancel();return {status:'response_too_large'};}
     chunks.push(value);
   }
   return {status:'ok',data:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
 }catch{return {status:'invalid_json'};}
}
async function getOfficialJson(url,{fetchFn=fetch,timeoutMs=16000}={}){
 const u=new URL(url);
 if(u.protocol!=='https:'||u.hostname!=='pncp.gov.br'||
   !u.pathname.startsWith('/api/consulta/v1/'))throw Error('Host nao autorizado');
 try{
   return await boundedResponse(await fetchFn(url,{headers:{Accept:'application/json'},
     redirect:'error',signal:AbortSignal.timeout(timeoutMs)}));
 }catch{return {status:'network_unavailable'};}
}
function envelope(data){
 const rows=Array.isArray(data?.data)?data.data:
   Array.isArray(data?.dados)?data.dados:null;
 const total=Number(data?.totalPaginas);
 if(!Array.isArray(rows)||!Number.isSafeInteger(total)||total<0||total>1000)
   return null;
 if(rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))return null;
 if((total===0&&rows.length!==0)||(total>0&&!rows.length)||rows.length>PAGE_SIZE)
   return null;
 return {rows,total};
}
function idFromRow(row,kind){
 if(kind==='contratos_atualizacao')return row.numeroControlePNCP;
 return row.numeroControlePNCPContrato??
   row.numeroControlePncpContrato??row.numeroControlePNCPContratoEmpenho;
}
function contextFromArchives(archives){
 const contracts=new Set(),ne=new Set();
 if(!Array.isArray(archives?.contracts)||!Array.isArray(archives?.months))
   throw Error('Contexto documental invalido');
 for(const item of archives.contracts){
   if(typeof item?.pncpId==='string'&&PNCP_ID.test(item.pncpId))
     contracts.add(item.pncpId);
 }
 for(const month of archives.months){
   if(!Array.isArray(month?.documents)||!Array.isArray(month?.relations))
     throw Error('Mes de comparacao invalido');
   for(const doc of month.documents){
     if(NE.test(doc?.id||''))ne.add(doc.id);
   }
   for(const rel of month.relations){
     if(NE.test(rel?.to||''))ne.add(rel.to);
   }
 }
 return {contracts,ne};
}
function freshCounters(){
 return {rowsExamined:0,officialPncpIds:0,matchedArchivedPncpIds:0,
   rowsWithFullSiafiNe:0,fullNeFoundInCguArchive:0,
   publishedBeforeUpdateWindow:0};
}
function countRows(rows,kind,ctx,initial,acc){
 for(const row of rows){
   acc.rowsExamined++;
   const id=idFromRow(row,kind);
   if(typeof id==='string'&&PNCP_ID.test(id)){
     acc.officialPncpIds++;
     if(ctx.contracts.has(id))acc.matchedArchivedPncpIds++;
   }
   // Apenas campo OFICIAL explicitamente identificado, sem matching heuristico.
   const ne=typeof row.numeroEmpenho==='string'?row.numeroEmpenho:null;
   if(ne&&NE.test(ne)){
     acc.rowsWithFullSiafiNe++;
     if(ctx.ne.has(ne))acc.fullNeFoundInCguArchive++;
   }
   if(kind==='contratos_atualizacao'&&
      typeof row.dataPublicacaoPncp==='string'&&
      isoDate(row.dataPublicacaoPncp.slice(0,10))&&
      row.dataPublicacaoPncp.slice(0,10)<initial)
     acc.publishedBeforeUpdateWindow++;
 }
}
/**
 * MAX 2 paginas de 5 registros por fonte. Se nao chegou ao fim, amostra
 * parcial e explicitamente rotulada; jamais declarar ausencia ou completude.
 */
export async function probePncp(kind,initial,final,archives,{
 fetchFn=fetch,maxPages=MAX_PAGES
}={}){
 if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES)
   throw Error('Limite de sondagem invalido');
 const ctx=contextFromArchives(archives),counts=freshCounters();
 const signatures=new Set();
 let pagesDeclared=null,consulted=0;
 for(let page=1;page<=maxPages;page++){
   const url=pncpProbeUrl(kind,initial,final,page);
   const result=await getOfficialJson(url,{fetchFn});
   if(result.status!=='ok')return {kind,status:result.status,pagesConsulted:consulted,
     counts: freshCounters()};
   const parsed=envelope(result.data);
   if(!parsed)return {kind,status:'invalid_envelope',pagesConsulted:consulted,
     counts:freshCounters()};
   if(pagesDeclared===null)pagesDeclared=parsed.total;
   if(pagesDeclared!==parsed.total)return {kind,status:'pagination_changed',
     pagesConsulted:consulted,counts:freshCounters()};
   const signature=JSON.stringify(parsed.rows.map(x=>idFromRow(x,kind)??''));
   if(signatures.has(signature)&&page>1)return {
     kind,status:'repeated_page',pagesConsulted:consulted,counts:freshCounters()};
   signatures.add(signature);
   consulted++;
   countRows(parsed.rows,kind,ctx,initial,counts);
   if(pagesDeclared===0||page===pagesDeclared)
     return {kind,status:pagesDeclared===0?'empty_complete':'sample_complete',
       pagesConsulted:consulted,pagesDeclared,counts};
 }
 return {kind,status:'sample_incomplete',pagesConsulted:consulted,
   pagesDeclared,counts};
}
const ACCESS=Object.freeze([
 {name:'swagger_html',path:'/api/docs'},
 {name:'openapi_json',path:'/docs/api-docs.json'},
 {name:'rp_period_unauthenticated',path:'/api/v1/empenho/rp'},
 {name:'contracts_by_ug_unauthenticated',path:'/api/contrato/ug/158459'}
]);
async function fetchStatus(url,{fetchFn=fetch}={}){
 let response;
 try{
   response=await fetchFn(url,{headers:{Accept:'application/json, text/html'},
     redirect:'error',signal:AbortSignal.timeout(15000)});
 }catch{return {status:'network_unavailable'};}
 // Sem ler registros da UG (podem conter pessoas, valores e contratos).
 if(!response?.ok){
   const status=failure(response?.status);
   try{await response?.body?.cancel();}catch{}
   return {status};
 }
 return {status:'http_200',response};
}
/** Inspeciona acessibilidade; 401 e 422 nao sao evidencia de inexistencia. */
export async function probeContratosGov({fetchFn=fetch}={}){
 const out=[];
 for(const item of ACCESS){
   const x=await fetchStatus(CONTRACTS+item.path,{fetchFn});
   if(item.name==='openapi_json'&&x.status==='http_200'){
     const parsed=await boundedResponse(x.response);
     if(parsed.status==='ok'){
       const src=API_CATALOG.find(c=>c.name==='CONTRATOS_GOV');
       const meta=summarizeOpenApi(parsed.data,src);
       out.push({name:item.name,status:meta.status,routes:meta.routes});continue;
     }
     out.push({name:item.name,status:parsed.status});continue;
   }
   if(x.response){
     try{await x.response.body?.cancel();}catch{}
   }
   out.push({name:item.name,status:x.status});
 }
 return out;
}
function lastDates(now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))
   throw Error('Referencia temporal invalida');
 const day=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
 const end=day.toISOString().slice(0,10);
 return {initial:new Date(day.getTime()-13*86400000).toISOString().slice(0,10),
   final:end};
}
export async function main(){
 const root=process.cwd();
 const manifest=JSON.parse(await readFile(join(root,'data/manifest.json'),'utf8'));
 const contracts=JSON.parse(await readFile(join(root,'data/procurement/contracts.json'),'utf8'));
 const months=await Promise.all(manifest.months.map(async month=>
   JSON.parse(await readFile(join(root,'data/months',month+'.json'),'utf8'))));
 const archive={contracts:contracts.contracts,months};
 const {initial,final}=lastDates();
 for(const item of PROBES){
   const result=await probePncp(item.kind,initial,final,archive);
   console.log('Amostra PNCP publica: '+JSON.stringify({...result,window:{initial,final}}));
 }
 const access=await probeContratosGov();
 console.log('Acesso anonimo Contratos.gov: '+JSON.stringify(access));
 console.log('Sondagem pequena e somente leitura; nenhum contrato/NE/CPF/valor '+
   'ou resposta bruta registrado. Falta de vinculo nao prova ausencia no SIAFI.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 main().catch(()=>{
   console.error('Sondagem de dados oficiais interrompida sem gravar arquivos.');
   process.exitCode=1;
 });
}

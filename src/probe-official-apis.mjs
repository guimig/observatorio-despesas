/**
 * Sondagem efemera dos catalogos oficiais OpenAPI, sem consultar dados da
 * execucao ou persistir payloads. Falha de acesso nao e ausencia de registros.
 * Somente rotas predefinidas e nomes de parametros entram nos logs.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const API_CATALOG=Object.freeze([
 {name:'CGU',url:'https://api.portaldatransparencia.gov.br/v3/api-docs',
  routes:[
   '/api-de-dados/despesas/documentos',
   '/api-de-dados/despesas/documentos/{codigo}',
   '/api-de-dados/despesas/documentos-relacionados',
   '/api-de-dados/despesas/empenhos-impactados',
   '/api-de-dados/despesas/itens-de-empenho/historico']},
 {name:'CONTRATOS_GOV',url:'https://contratos.comprasnet.gov.br/docs/api-docs.json',
  routes:[
   '/api/v1/empenho/rp',
   '/api/v2/empenho',
   '/api/v1/empenho/ano/{ano}/ug/{unidade}',
   '/api/v1/empenho/ug/{unidade}',
   '/api/v1/empenho',
   '/api/v1/contrato/empenho/consultar/{empenho_id}',
   '/api/contrato/{contrato_id}/empenhos',
   '/api/v1/minuta/uasg/{uasg_da_minuta}/ano/{ano}',
   '/api/v1/contrato/empenhoporuasg/{codigo_unidade_emitente}/{numero_empenho}',
   '/api/v1/empenho/pdm/{pdm}/ug/{unidade}/ano/{ano}',
   '/api/v1/empenho/codigoservico/{codigo}/ug/{unidade}/ano/{ano}']},
 {name:'SIAFI_STA',url:'https://sta.api.gov.br/docs?api-docs.json',
  routes:['/api/empenho/{dado}','/api/empenho/dadosbasicos/{dado}',
   '/api/empenho/ano/{ano}/ug/{ug}','/api/empenho/ano/{ano}/ug/{ug}/dia/{data}',
   '/api/rp/ano/{ano}/ug/{ug}','/api/estrutura/naturezadespesas',
   '/api/saldocontabil/ano/{ano}/ug/{unidade}/gestao/{gestao}/contacontabil/{conta_contabil}',
   '/api/ordembancaria/documento/{dado}']},
 {name:'PNCP',url:'https://pncp.gov.br/api/consulta/v3/api-docs',
  routes:[
   '/v1/contratos/atualizacao',
   '/v1/instrumentoscobranca/inclusao']}
]);
const MAX_BYTES=8*1024*1024;
const SAFE_NAME=/^[a-zA-Z0-9_-]{1,60}$/;

function paramShape(param){
 if(param?.in!=='query'||typeof param.name!=='string'||!SAFE_NAME.test(param.name))
   return null;
 const value={name:param.name,required:param.required===true};
 // Restricao NUMERICA publicada na especificacao, sem mensagens livres.
 for(const key of ['minimum','maximum']){
   const limit=param.schema?.[key];
   if(Number.isSafeInteger(limit)&&limit>=0&&limit<=100000)
     value[key]=limit;
 }
 return value;
}

/** Nenhuma chave nao selecionada, exemplo, responseBody ou dado pessoal e retornado. */
export function summarizeOpenApi(spec,source){
 if(!spec||typeof spec!=='object'||Array.isArray(spec)||!spec.paths||
   typeof spec.paths!=='object'||Array.isArray(spec.paths))
   return {status:'invalid_openapi',routes:[]};
 const rootSecurity=Array.isArray(spec.security)?spec.security:null;
 const routes=source.routes.map(path=>{
   const item=spec.paths[path],operation=item?.get;
   if(!operation||typeof operation!=='object')
     return {path,status:'not_documented'};
   const params=[...(Array.isArray(item.parameters)?item.parameters:[]),
     ...(Array.isArray(operation.parameters)?operation.parameters:[])];
   const cleanParams=params.map(paramShape).filter(Boolean);
   const unique=new Map(cleanParams.map(p=>[p.name,p]));
   const security=Array.isArray(operation.security)?operation.security:rootSecurity;
   return {path,status:'documented',query:[...unique.values()].slice(0,30),
     parameterReferences:params.some(p=>typeof p?.$ref==='string'),
     authentication:security?.length?'declared':'not_declared'};
 });
 return {status:'openapi_available',routes};
}
async function boundedJson(response){
 if(!response?.ok)return {status:response?.status===401||response?.status===403?
   'authentication_or_access_required':'http_unavailable'};
 const length=Number(response.headers?.get('content-length'));
 if(Number.isFinite(length)&&length>MAX_BYTES)return {status:'oversized_specification'};
 const body=response.body;
 if(!body||typeof body.getReader!=='function')return {status:'invalid_body'};
 const reader=body.getReader(),chunks=[];
 let bytes=0;
 try{
   while(true){
     const {done,value}=await reader.read();
     if(done)break;
     bytes+=value.length;
     if(bytes>MAX_BYTES){await reader.cancel();return {status:'oversized_specification'};}
     chunks.push(value);
   }
   const text=new TextDecoder().decode(Buffer.concat(chunks));
   const data=JSON.parse(text);
   return {status:'parsed',data};
 }catch{return {status:'invalid_json_or_body'};}
}
/** Restrito a catalogos whitelisted; nenhum endpoint financeiro e chamado. */
export async function inspectOfficialCatalog(source,{
 fetchFn=fetch,timeoutMs=16000
}={}){
 const matched=API_CATALOG.find(item=>item.name===source?.name&&item.url===source.url);
 if(!matched)throw Error('Fonte nao autorizada');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
   throw Error('Timeout invalido');
 let response;
 try{
   response=await fetchFn(source.url,{headers:{Accept:'application/json'},
     redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
 }catch{return {source:source.name,status:'network_unavailable',routes:[]};}
 const result=await boundedJson(response);
 if(result.status!=='parsed')return {source:source.name,status:result.status,routes:[]};
 return {source:matched.name,...summarizeOpenApi(result.data,matched)};
}
export async function main(){
 for(const source of API_CATALOG){
   const result=await inspectOfficialCatalog(source);
   console.log('Metadados oficiais OpenAPI: '+JSON.stringify(result));
 }
 console.log('Sondagem de documentacao: nao testa acesso aos dados, cobertura, '+
   'atualizacao da UG 158459, autenticacao efetiva ou saldos de RAP.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 main().catch(()=>{
   console.error('Sondagem de metadados nao concluida; nenhum dado alterado.');
   process.exitCode=1;
 });
}

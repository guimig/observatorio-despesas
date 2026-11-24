/**
 * Preflight estrito de acesso ao Portal da Transparencia/CGU, somente leitura.
 * Usa uma NE controle ja presente e com historico conhecido no catalogo local;
 * NUNCA imprime documento, data, resposta, texto livre, valor ou token.
 * Uma resposta valida no controle nao homologa a semantica de qualquer NE.
 */
import {readFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {documentUrl} from './cgu.mjs';
import {detailUrl} from './inspect-cgu-siafi.mjs';
import {itemsUrl} from './enrich-cgu.mjs';
import {validateManifest,validateMonth} from './store.mjs';

const NE=/^158459\d{5}(20\d{2})NE\d{6}$/;
const DATE=/^20\d{2}-(0[1-9]|1[0-2])-[0-3]\d$/;
const ROUTES=['documents','detail','items'];
const br=date=>date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);
const safeControl=control=>
  Boolean(control&&NE.test(control.id)&&DATE.test(control.date)&&
    control.date.slice(0,4)===NE.exec(control.id)[1]&&
    new Date(control.date+'T00:00:00Z').toISOString().slice(0,10)===control.date);
const isReadyItem=item=>Number.isSafeInteger(item?.seq)&&item.seq>=1&&
  item.historyChecked===true;

/** Usa uma NE real cujo historico de pelo menos um item ja foi consultado. */
export function pickCguAccessControl(months){
 if(!Array.isArray(months))throw Error('Catalogo para preflight invalido');
 for(const month of [...months].sort((a,b)=>b.month.localeCompare(a.month))){
   if(!Array.isArray(month?.documents)||!month?.itemsByDocument||
      !Array.isArray(month.coverage))continue;
   for(const doc of month.documents){
     const control={id:doc.id,date:doc.date};
     if(doc.phase!==1||!safeControl(control))continue;
     if(!month.coverage.some(c=>c.phase===1&&c.date===doc.date&&c.complete===true))
       continue;
     if(!(month.itemsByDocument[doc.id]||[]).some(isReadyItem))continue;
     return control;
   }
 }
 throw Error('Sem NE controle validada no catalogo local');
}
async function readControl(root){
 const manifest=validateManifest(JSON.parse(await readFile(
   join(root,'data/manifest.json'),'utf8')));
 const months=[];
 for(const month of [...manifest.months].sort().reverse()){
   const data=validateMonth(JSON.parse(await readFile(
     join(root,'data/months',month+'.json'),'utf8')));
   months.push(data);
 }
 return pickCguAccessControl(months);
}
function classifyResponse(response){
 if(!response||!Number.isSafeInteger(response.status))
   return 'invalid_http';
 if(response.status===401)return 'http_401';
 if(response.status===403)return 'http_403';
 if(response.status===404)return 'http_404';
 if(response.status===429)return 'http_429';
 if(response.status>=500&&response.status<=599)return 'http_5xx';
 if(response.status<200||response.status>=300)return 'http_other';
 const contentType=response.headers?.get?.('content-type')||'';
 return /(?:^|[+/])json(?:\s*;|\s*$)/i.test(contentType)?
   'ok':'unexpected_content_type';
}
async function testOne(url,{token,fetchFn,timeoutMs}){
 try{
   const response=await fetchFn(url,{
     headers:{Accept:'application/json','chave-api-dados':token},
     signal:AbortSignal.timeout(timeoutMs),redirect:'error'
   });
   const status=classifyResponse(response);
   try{await response.body?.cancel?.();}catch{}
   return status;
 }catch{return 'network_unavailable';}
}
export async function checkCguAccess({
 root=process.cwd(),token,fetchFn=fetch,control=null,timeoutMs=12000
}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>20000)
   throw Error('Timeout do preflight CGU invalido');
 if(typeof token!=='string'||!token.trim())
   return {status:'credential_unavailable',authorized:false,checks:[]};
 const sample=control||await readControl(root);
 if(!safeControl(sample))throw Error('Controle CGU invalido');
 const requests=[
   documentUrl(br(sample.date),1,1),
   detailUrl(sample.id),
   itemsUrl(sample.id,1)
 ];
 const checks=[];
 for(let i=0;i<ROUTES.length;i++){
   const status=await testOne(requests[i],{token,fetchFn,timeoutMs});
   checks.push({route:ROUTES[i],status});
   if(status!=='ok')return {status:'blocked',authorized:false,checks};
 }
 return {status:'authorized',authorized:true,checks};
}
async function main(){
 try{
   const result=await checkCguAccess({root:resolve(process.cwd()),
     token:process.env.CGU_API_KEY});
   console.log('Preflight de acesso CGU (sem identificadores): '+
     JSON.stringify(result));
   if(process.env.GITHUB_OUTPUT)
     await appendFile(process.env.GITHUB_OUTPUT,
       'authorized='+(result.authorized?'true':'false')+'\n','utf8');
 }catch{
   console.error('Preflight CGU inconclusivo; sondagem historica nao autorizada.');
   if(process.env.GITHUB_OUTPUT)
     await appendFile(process.env.GITHUB_OUTPUT,'authorized=false\n','utf8');
   process.exitCode=1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main();

/** Sondagem mínima: inspeciona formas de retorno, nunca dados contratuais. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {requestPublicJSON,HttpFailure} from './procurement.mjs';
import {structuralFields} from './inspect-cgu.mjs';

const PNCP_ID=/^10635424000186-1-(\d{6})\/(20\d{2})$/;
const CONTRACT_ID=/^10635424000186-2-(\d{6})\/(20\d{2})$/;
const BASE='https://pncp.gov.br/api/pncp/v1/orgaos/10635424000186';
export function linkedContractsUrl(id){
 const m=PNCP_ID.exec(id||'');
 if(!m)throw Error('Contratação PNCP inválida');
 return BASE+'/contratos/contratacao/'+m[2]+'/'+Number(m[1]);
}
export function contractDetailUrl(id){
 const m=CONTRACT_ID.exec(id||'');
 if(!m)throw Error('Contrato PNCP inválido');
 return BASE+'/contratos/'+m[2]+'/'+Number(m[1]);
}
export function summarizeShape(payload){
 if(payload===null)return {type:'null',count:0,fields:[]};
 const data=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:
   Array.isArray(payload?.resultado)?payload.resultado:
   payload&&typeof payload==='object'?[payload]:[];
 return {type:Array.isArray(payload)?'array':'object',
   count:data.length,
   fields:data.length?structuralFields(data[0],0)
     .filter(name=>/^[a-zA-Z][a-zA-Z0-9_.:]{0,90}$/.test(name))
     .sort().slice(0,90):[]};
}
async function main(){
 const notices=JSON.parse(await readFile(resolve('data/procurement/notices.json'),'utf8'));
 const contracts=JSON.parse(await readFile(resolve('data/procurement/contracts.json'),'utf8'));
 const sample=[...notices.notices].sort((a,b)=>
   (Number(b.process?.startsWith('23349'))-Number(a.process?.startsWith('23349')))||
   a.id.localeCompare(b.id)).slice(0,3);
 for(let i=0;i<sample.length;i++){
   try{
     const result=await requestPublicJSON(linkedContractsUrl(sample[i].pncpId));
     console.log('Contratação amostra '+(i+1)+': '+JSON.stringify(summarizeShape(result)));
   }catch(err){
     console.log('Contratação amostra '+(i+1)+': HTTP '+
       (err instanceof HttpFailure?err.status:0));
   }
 }
 for(let i=0;i<Math.min(2,contracts.contracts.length);i++){
   try{
     const result=await requestPublicJSON(contractDetailUrl(contracts.contracts[i].pncpId));
     console.log('Contrato detalhe amostra '+(i+1)+': '+JSON.stringify(summarizeShape(result)));
   }catch(err){
     console.log('Contrato detalhe amostra '+(i+1)+': HTTP '+
       (err instanceof HttpFailure?err.status:0));
   }
 }
 console.log('Apenas tipos e nomes de campos foram registrados, sem dados de documentos ou pessoas.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 main().catch(()=>{console.error('Diagnóstico encerrado sem publicar valores.');process.exitCode=1});
}

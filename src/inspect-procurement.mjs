/** Apenas diagnóstico do schema de APIs públicas; nunca persiste ou imprime respostas. */
import { fileURLToPath } from 'node:url';
import { structuralFields } from './inspect-cgu.mjs';
const P='https://pncp.gov.br/api/consulta/v1/contratos';
const C='https://dadosabertos.compras.gov.br';
const campusCnpj='10635424000348';
export function shapeOnly(row){
  if (!row || typeof row!=='object')return [];
  return structuralFields(row,1).filter(x=>!x.toLowerCase().includes('cpf'));
}
export function pncpUrl(begin,end,page=1){
  if(!/^\d{8}$/.test(begin)||!/^\d{8}$/.test(end)||!Number.isInteger(page)||page<1)
    throw Error('Argumentos PNCP incorretos');
  return P+'?'+new URLSearchParams({
    dataInicial:begin,dataFinal:end,cnpjOrgao:campusCnpj,
    pagina:String(page),tamanhoPagina:'30'
  });
}
export function comprasUasgUrl(){
  return C+'/modulo-uasg/1_consultarUasg?'+new URLSearchParams({
    codigoUasg:'158459',pagina:'1',tamanhoPagina:'10'
  });
}
export function comprasContractsUrl(org){
  if(!/^\d{3,9}$/.test(String(org)))throw Error('Código de órgão ausente');
  return C+'/modulo-contratos/1_consultarContratos?'+new URLSearchParams({
    codigoOrgao:String(org),codigoUnidadeGestora:'158459',
    pagina:'1',tamanhoPagina:'10'
  });
}
async function safeGet(url){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(16000)});
      if(r.status===204)return {status:204,body:null};
      if((r.status===429||r.status>=500)&&attempt<2){
        await new Promise(resolve=>setTimeout(resolve,1300*(attempt+1)));continue;
      }
      if(!r.ok)return {status:r.status,body:null};
      return {status:r.status,body:await r.json()};
    }catch{
      if(attempt===2)return {status:0,body:null};
      await new Promise(resolve=>setTimeout(resolve,900*(attempt+1)));
    }
  }
  return {status:0,body:null};
}
export function safeSummary(result){
  if (!result?.body || typeof result.body!=='object')return {
    status:result?.status,rows:0,keys:[]
  };
  const body=result.body;
  const list=Array.isArray(body)?body:(Array.isArray(body.dados)?body.dados:
    Array.isArray(body.resultado)?body.resultado:[]);
  return {status:result.status,rows:list.length,
    envelope:shapeOnly(body).filter(x=>!x.startsWith('dados:')&&!x.startsWith('resultado:')),
    keys:list.length?shapeOnly(list[0]):[]};
}
async function main(){
  for(const [begin,end] of [['20261101','20261118'],['20261001','20261031'],['20260101','20260930']]){
    const r=await safeGet(pncpUrl(begin,end));
    console.log('PNCP contratos '+begin+': '+JSON.stringify(safeSummary(r)));
  }
  const variants=[
    ['campus_documentado',C+'/modulo-uasg/1_consultarUasg?pagina=1&codigoUasg=158459&statusUasg=true'],
    ['campus_sem_status',C+'/modulo-uasg/1_consultarUasg?pagina=1&codigoUasg=158459'],
    ['controle_reitoria',C+'/modulo-uasg/1_consultarUasg?pagina=1&codigoUasg=158125&statusUasg=true']
  ];
  let uasg=null;
  for(const [label,url] of variants){
    const result=await safeGet(url);
    console.log('Compras UASG '+label+': '+JSON.stringify(safeSummary(result)));
    const rows=result.body?.resultado??result.body?.dados??result.body?.data;
    if(!uasg&&Array.isArray(rows)&&rows.some(r=>String(r.codigoUasg)==='158459'))uasg=result;
  }
  const list=uasg?.body?.resultado??uasg?.body?.dados??uasg?.body?.data;
  const org=Array.isArray(list)?
    list.find(row=>String(row.codigoUasg)==='158459')?.codigoOrgao:null;
  if (org && /^\d{3,9}$/.test(String(org))) {
    console.log('Compras código do órgão (não pessoal): '+String(org));
    const c=await safeGet(comprasContractsUrl(org));
    console.log('Compras contratos UG: '+JSON.stringify(safeSummary(c)));
  }else{
    console.log('Compras contratos UG: não consultado, código de órgão não confirmado');
  }
  console.log('Fim da sondagem: nenhuma resposta bruta, fornecedor, CPF ou contrato individual foi publicado.');
}
if (process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  main().catch(()=>{console.error('Diagnóstico de contratos encerrado sem dados pessoais.');process.exitCode=1;});
}

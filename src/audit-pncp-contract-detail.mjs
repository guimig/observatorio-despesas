/** Auditoria de presenca de campos do detalhe PNCP sem armazenar payloads. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {contractDetailUrl} from './pncp-contract-link.mjs';
import {requestPublicJSON} from './procurement.mjs';

export const CONTRACT_DETAIL_FIELDS=Object.freeze([
 'numeroControlePNCP','numeroControlePncpCompra','numeroControlePNCPCompra',
 'numeroContratoEmpenho','dataAssinatura','dataVigenciaInicio','dataVigenciaFim',
 'valorGlobal','valorInicial','valorAtualizado','valorAcumulado',
 'dataPublicacaoPncp','dataAtualizacao','dataAtualizacaoGlobal',
 'tipoContrato','categoriaProcesso','processo','objetoContrato',
 'informacaoComplementar','fundamentacaoLegal','amparoLegal',
 'niFornecedor','tipoPessoa','nomeRazaoSocialFornecedor',
 'termosAditivos','apostilamentos','alteracoes','historico','parcelas',
 'itens','unidadeOrgao','orgaoEntidade'
]);
export function inspectContractDetail(body,expectedId){
 if(!body||typeof body!=='object'||Array.isArray(body)||
    body.numeroControlePNCP!==expectedId)
  throw Error('Detalhe PNCP divergente do instrumento consultado');
 const fields={};
 for(const key of CONTRACT_DETAIL_FIELDS){
  if(!Object.hasOwn(body,key))continue;
  const value=body[key];
  fields[key]={present:true,kind:Array.isArray(value)?'array':
   value===null?'null':typeof value,nonempty:Array.isArray(value)?
   value.length>0:value!==null&&value!==''};
 }
 return fields;
}
export async function auditContractDetails(contracts,{fetcher=requestPublicJSON,limit=8}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>20)throw Error('Limite invalido');
 const sample=contracts.filter(c=>c?.source==='pncp'&&c?.pncpId).slice(0,limit);
 const result={attempted:sample.length,success:0,failed:0,fields:{}};
 for(const contract of sample){
  try{
   const body=await fetcher(contractDetailUrl(contract.pncpId));
   const fields=inspectContractDetail(body,contract.pncpId);
   result.success++;
   for(const [key,value] of Object.entries(fields)){
    const count=result.fields[key]??{present:0,nonempty:0,kinds:{}};
    count.present++;
    if(value.nonempty)count.nonempty++;
    count.kinds[value.kind]=(count.kinds[value.kind]??0)+1;
    result.fields[key]=count;
   }
  }catch{result.failed++;}
 }
 return result;
}
async function main(){
 const data=JSON.parse(await readFile('data/procurement/contracts.json','utf8'));
 const limit=Number(process.env.PNCP_CONTRACT_AUDIT_LIMIT||8);
 const result=await auditContractDetails(data.contracts||[],{limit});
 console.log('Auditoria estrutural PNCP (sem dados pessoais ou payloads): '+JSON.stringify(result));
}
if(process.argv[1]===fileURLToPath(import.meta.url))
 main().catch(()=>{console.error('Auditoria de detalhes PNCP indisponivel');process.exitCode=1;});

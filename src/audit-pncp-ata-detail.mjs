/** Auditoria pontual dos campos de detalhe de atas PNCP; sem gravar payload. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ataUrl} from './pncp-atas.mjs';
import {requestPublicJSON} from './procurement.mjs';

const FIELDS=['numeroAtaRegistroPreco','dataVigenciaFim','possibilidadeAdesao',
 'itens','itensAta','quantidade','quantidadeRegistrada','quantidadeTotal',
 'fornecedores','partesEnvolvidas','participantes','quantitativosPorParticipante'];
export function detailUrl(ata){
 if(!Number.isSafeInteger(ata?.sequence)||ata.sequence<1)throw Error('Sequencial invalido');
 return ataUrl(ata.procurementId)+'/'+ata.sequence;
}
export function inspectDetail(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Detalhe PNCP invalido');
 const present=FIELDS.filter(k=>Object.hasOwn(body,k));
 const arrays=present.filter(k=>Array.isArray(body[k]));
 const nonemptyArrays=arrays.filter(k=>body[k].length>0);
 return {present,arrays,nonemptyArrays};
}
export async function auditDetails(atas,{fetcher=requestPublicJSON,limit=5}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw Error('Limite invalido');
 const sample=atas.slice(0,limit);
 const counts={attempted:sample.length,success:0,failed:0,fields:{}};
 for(const ata of sample){
  try{
   const result=inspectDetail(await fetcher(detailUrl(ata)));
   counts.success++;
   for(const k of result.present)counts.fields[k]=(counts.fields[k]||0)+1;
   for(const k of result.nonemptyArrays)counts.fields[k+':nonempty']=(counts.fields[k+':nonempty']||0)+1;
  }catch{counts.failed++}
 }
 return counts;
}
async function main(){
 const data=JSON.parse(await readFile('data/procurement/atas.json','utf8'));
 const sample=data.atas.filter(a=>a.sequence===1);
 const limit=Number(process.env.PNCP_DETAIL_AUDIT_LIMIT||5);
 const result=await auditDetails(sample,{limit});
 console.log('Auditoria estrutural do detalhe PNCP (sem payload): '+JSON.stringify(result));
}
if(process.argv[1]===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error(e.message);process.exitCode=1});

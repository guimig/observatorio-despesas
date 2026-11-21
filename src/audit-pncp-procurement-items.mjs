/** Auditoria de itens de licitacoes PNCP, sem persistir respostas brutas. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {requestPublicJSON} from './procurement.mjs';
const ID=/^(10635424000186|10635424000348)-1-(\d{6})\/(20\d{2})$/;
export function procurementItemsUrl(id,page=1){
 const m=ID.exec(String(id??''));
 if(!m||!Number.isSafeInteger(page)||page<1||page>1000)
  throw Error('Identificador ou pagina PNCP invalida');
 return 'https://pncp.gov.br/api/pncp/v1/orgaos/'+m[1]+'/compras/'+
  m[3]+'/'+Number(m[2])+'/itens?pagina='+page+'&tamanhoPagina=50';
}
export function inspectItems(body){
 const rows=Array.isArray(body)?body:
  Array.isArray(body?.data)?body.data:Array.isArray(body?.dados)?body.dados:null;
 if(!rows)throw Error('Resposta de itens PNCP nao reconhecida');
 const fields=['numeroItem','descricao','quantidade','quantidadeHomologada',
  'valorUnitarioEstimado','valorTotal','valorUnitarioHomologado','situacaoCompraItemId'];
 const present=Object.fromEntries(fields.map(k=>[k,rows.filter(r=>r&&Object.hasOwn(r,k)).length]));
 return {rows:rows.length,present,hasPagination:!Array.isArray(body),
  totalPages:Number.isSafeInteger(Number(body?.totalPaginas))?Number(body.totalPaginas):null};
}
export async function auditItems(notices,{fetcher=requestPublicJSON,limit=5}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw Error('Limite de amostra invalido');
 const sample=notices.slice(0,limit);
 const result={attempted:sample.length,success:0,failed:0,rows:0,fields:{}};
 for(const notice of sample){
  try{
   const item=inspectItems(await fetcher(procurementItemsUrl(notice.pncpId)));
   if(item.hasPagination&&item.totalPages!==null&&item.totalPages>1){
    // Amostra estrutural somente; nunca publicar lista parcial de itens.
    result.paginated=(result.paginated||0)+1;
   }
   result.success++;result.rows+=item.rows;
   for(const [key,n] of Object.entries(item.present))
    result.fields[key]=(result.fields[key]||0)+n;
  }catch{result.failed++}
 }
 return result;
}
async function main(){
 const catalog=JSON.parse(await readFile('data/procurement/notices.json','utf8'));
 const srps=catalog.notices.filter(n=>n.srp===true);
 const distinct=srps.slice().sort((a,b)=>a.pncpId.localeCompare(b.pncpId));
 const limit=Number(process.env.PNCP_ITEMS_AUDIT_LIMIT||5);
 console.log('Auditoria de itens PNCP (apenas contagens): '+JSON.stringify(
  await auditItems(distinct,{limit})));
}
if(process.argv[1]===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error(e.message);process.exitCode=1});

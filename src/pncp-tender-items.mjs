/** Itens licitados no PNCP: dados institucionais, nunca saldos de ata. */
import {procurementItemsUrl} from './audit-pncp-procurement-items.mjs';
import {requestPublicJSON} from './procurement.mjs';
import {publicItemDescription} from './enrich-cgu.mjs';
import {assertPublicSafe} from './privacy.mjs';
import {inScopePurchaseId} from './collection-scope.mjs';
const ID=/^(10635424000186|10635424000348)-1-\d{6}\/20\d{2}$/;
export function normalizeTenderItem(row,pncpId){
 if(!ID.test(pncpId)||!row||typeof row!=='object')return null;
 const number=Number(row.numeroItem),quantity=Number(row.quantidade);
 if(!Number.isSafeInteger(number)||number<1||!Number.isFinite(quantity)||quantity<0||quantity>1e12)return null;
 const description=publicItemDescription(row.descricao,240);
 if(!description)return null;
 const item={pncpId,number,description,quantity,scope:'ifc_tendered'};
 return assertPublicSafe(item);
}
export async function fetchTenderItems(pncpId,{fetcher=requestPublicJSON,maxPages=100}={}){
 if(!ID.test(pncpId)||!inScopePurchaseId(pncpId)||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>100)
  throw Error('Consulta de itens invalida');
 const records=[],seen=new Set();let total=null;
 for(let page=1;page<=maxPages;page++){
  const body=await fetcher(procurementItemsUrl(pncpId,page));
  const rows=Array.isArray(body?.data)?body.data:Array.isArray(body?.dados)?body.dados:
   Array.isArray(body)?body:null;
  const pages=Number(body?.totalPaginas??1);
  if(!rows||!Number.isSafeInteger(pages)||pages<0||pages>100||
    (total!==null&&pages!==total))throw Error('Paginacao de itens invalida');
  if(total===null)total=pages;
  if(pages===0&&rows.length===0)return [];
  if(!rows.length||page>pages)throw Error('Pagina de itens vazia ou excedente');
  for(const row of rows){
   const item=normalizeTenderItem(row,pncpId);
   if(!item||seen.has(item.number))throw Error('Item invalido ou duplicado; coleta incompleta');
   seen.add(item.number);records.push(item);
  }
  if(page===pages)return records.sort((a,b)=>a.number-b.number);
 }
 throw Error('Limite de paginas excedido; nao publicar coleta parcial');
}

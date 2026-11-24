/** Resultado homologado e sua situacao no PNCP. Nao e ata, saldo ou despesa.
 * Manual de Integracao PNCP 2.6, secao 11.17.
 */
import {requestPublicJSON} from './procurement.mjs';
import {inScopePurchaseId,inScopeDate} from './collection-scope.mjs';
import {assertPublicSafe,maskCpf} from './privacy.mjs';
import {stateKey,validDay} from './operational-state.mjs';
const ID=/^(10635424000186|10635424000348)-1-(\d{6})\/(20\d{2})$/;
const int=n=>Number.isSafeInteger(n)&&n>0;
const decimal=v=>{
 if(typeof v!=='number'&&typeof v!=='string')return null;
 const s=String(v);
 if(!/^\d{1,13}(?:\.\d{1,8})?$/.test(s)||!Number.isFinite(Number(s)))return null;
 return s.includes('.')?s.replace(/0+$/,'').replace(/\.$/,''):s;
};
export function resultUrl(id,number){
 const m=ID.exec(id||'');
 if(!m||!inScopePurchaseId(id)||!int(number))throw Error('Resultado PNCP fora do escopo');
 return 'https://pncp.gov.br/api/pncp/v1/orgaos/'+m[1]+'/compras/'+m[3]+'/'+Number(m[2])+'/itens/'+number+'/resultados';
}
export function validateResults(rows){
 if(!Array.isArray(rows)||rows.length>1000)throw Error('Lista de resultados invalida');
 const keys=new Set();
 for(const r of rows){
  if(!r||typeof r!=='object'||Array.isArray(r)||
   Object.keys(r).some(k=>!['sequence','status','date','quantity','unitPrice','total','supplierType','supplierCnpj','supplierCpfMasked','rank','reserve','cancelledAt'].includes(k))||
   !int(r.sequence)||keys.has(r.sequence)||![1,2].includes(r.status)||
   !validDay(r.date)||!inScopeDate(r.date)||typeof r.quantity!=='string'||decimal(r.quantity)!==r.quantity||typeof r.unitPrice!=='string'||decimal(r.unitPrice)!==r.unitPrice||
   (r.total!==undefined&&(typeof r.total!=='string'||decimal(r.total)!==r.total))||
   !['PJ','PF','PE'].includes(r.supplierType)||
   (r.supplierCnpj!==undefined&&(r.supplierType!=='PJ'||!/^\d{14}$/.test(r.supplierCnpj)))||
   (r.supplierCpfMasked!==undefined&&(r.supplierType!=='PF'||!/^\*\*\*\.\d{3}\.\d{3}-\*\*$/.test(r.supplierCpfMasked)))||
   (r.rank!==undefined&&!int(r.rank))||(r.reserve!==undefined&&![1,2,3].includes(r.reserve))||
   (r.cancelledAt!==undefined&&(!validDay(r.cancelledAt)||!inScopeDate(r.cancelledAt))))
    throw Error('Resultado PNCP invalido');
  keys.add(r.sequence);
 }
 return assertPublicSafe(rows);
}
export function normalizeResult(row,id,number){
 resultUrl(id,number);
 if(!row||Number(row.numeroItem)!==number||
  (row.numeroControlePNCPCompra&&row.numeroControlePNCPCompra!==id))
  throw Error('Resultado de outro item ou procedimento');
 const r={sequence:Number(row.sequencialResultado),status:Number(row.situacaoCompraItemResultadoId),
  date:String(row.dataResultado??'').slice(0,10),quantity:decimal(row.quantidadeHomologada),
  unitPrice:decimal(row.valorUnitarioHomologado),supplierType:row.tipoPessoa??row.tipoPessoaId};
 const total=decimal(row.valorTotalHomologado);
 if(total!==null)r.total=total; // nao calcular se a fonte nao informou
 const vendor=String(row.niFornecedor??'').trim();
 if(r.supplierType==='PJ'&&/^\d{14}$/.test(vendor))r.supplierCnpj=vendor;
 if(r.supplierType==='PF'){
  try{r.supplierCpfMasked=maskCpf(vendor)}catch{/* Identificador ausente ou nao reconhecido. */}
 }
 const rank=Number(row.ordemClassificacaoSrp);
 if(int(rank))r.rank=rank;
 const reserve=Number(row.reservaRemanescenteId?.codigo??row.reservaRemanescenteId);
 if([1,2,3].includes(reserve))r.reserve=reserve;
 const cancelled=String(row.dataCancelamento??'').slice(0,10);
 if(validDay(cancelled)&&inScopeDate(cancelled))r.cancelledAt=cancelled;
 validateResults([r]);return r;
}
export async function fetchItemResults(item,{fetcher=requestPublicJSON}={}){
 const body=await fetcher(resultUrl(item.pncpId,item.number));
 const rows=Array.isArray(body)?body:body?.listaResultados??body?.data??body?.dados;
 if(!Array.isArray(rows))throw Error('Lista de resultados incompleta');
 if(!Array.isArray(body)){
  const pages=Number(body.totalPaginas??1),total=Number(body.totalRegistros??rows.length);
  if(!Number.isSafeInteger(pages)||pages<0||pages>1||(pages===0&&rows.length)||
     !Number.isSafeInteger(total)||total!==rows.length)throw Error('Lista de resultados incompleta');
 }
 const result=rows.map(row=>normalizeResult(row,item.pncpId,item.number)).sort((a,b)=>a.sequence-b.sequence);
 validateResults(result);
 return result;
}
export const resultKey=item=>stateKey(['pncp-item-results',item.pncpId,item.number,item.quantity,item.description,item.results??null]);
export function applyItemResults(item,results){
 validateResults(results);
 if((item.results||[]).some(old=>!results.some(r=>r.sequence===old.sequence)))
  throw Error('Resultado confirmado ausente; nao presumir cancelamento');
 if(JSON.stringify(item.results)===JSON.stringify(results))return item;
 return {...item,results};
}
export function planItemResults(procedures,{state={},now=new Date(),limit=15,slot=Math.floor(now.getTime()/86400000)}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>30||!Number.isSafeInteger(slot)||slot<0)throw Error('Limite de resultados invalido');
 const today=now.toISOString().slice(0,10);
 const eligible=procedures.filter(p=>ID.test(p.pncpId)&&inScopePurchaseId(p.pncpId)).sort((a,b)=>a.pncpId.localeCompare(b.pncpId));
 const off=slot%Math.max(1,eligible.length);
 const ordered=eligible.slice(off).concat(eligible.slice(0,off));
 const pending=[],reviews=[];
 for(const p of ordered){
  const a=[],b=[];
  for(const item of p.items){
   if(!Object.hasOwn(item,'results'))a.push(item);
   else{
    const stamp=state[resultKey(item)],interval=item.results.length?30:7;
    if(!validDay(stamp)||stamp>today||now.getTime()-Date.parse(stamp+'T00:00:00Z')>=interval*86400000)b.push(item);
   }
  }
  const rotate=list=>{const n=slot%Math.max(1,list.length);return list.slice(n).concat(list.slice(0,n))};
  if(a.length)pending.push(rotate(a));if(b.length)reviews.push(rotate(b));
 }
 const drain=(groups,max)=>{
  const out=[];
  while(out.length<max&&groups.some(g=>g.length))for(const g of groups){if(g.length)out.push(g.shift());if(out.length>=max)break}
  return out;
 };
 const reviewQuota=reviews.length?pending.length?Math.max(1,Math.floor(limit/5)):limit:0;
 const first=drain(pending,limit-reviewQuota);
 const second=drain(reviews,limit-first.length);
 return first.concat(second,drain(pending,limit-first.length-second.length));
}

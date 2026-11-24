/** Movimentacoes cronologicas de cada item: fatos CGU, nao saldos calculados. */
import {getCguArray,parseMoneyCents} from './cgu.mjs';
import {publicNarrativeText} from './public-narrative.mjs';
const NE=/^158459\d{5}20\d{2}NE\d{6}$/;
const OPS={inclusao:'original',emissao:'original',reforco:'reinforcement',
 anulacao:'annulment',cancelamento:'cancellation',estorno:'reversal'};
export function historyUrl(id,seq,page=1){
 if(!NE.test(id)||!Number.isSafeInteger(seq)||seq<1||seq>100000||
    !Number.isSafeInteger(page)||page<1||page>100)throw Error('Consulta historica de item invalida');
 return 'https://api.portaldatransparencia.gov.br/api-de-dados/despesas/itens-de-empenho/historico?'+
   new URLSearchParams({codigoDocumento:id,sequencial:String(seq),pagina:String(page)});
}
function dateOf(value){
 if(typeof value!=='string')return null;
 let match=/^(20\d{2})-(\d{2})-(\d{2})/.exec(value);
 if(match){const date=match[1]+'-'+match[2]+'-'+match[3];
   if(new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date)return date;
 }
 match=/^(\d{2})\/(\d{2})\/(20\d{2})/.exec(value);
 if(!match)return null;
 const date=match[3]+'-'+match[2]+'-'+match[1];
 return new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date?date:null;
}
export function officialDecimal(value,maxDecimals=8){
 if(typeof value!=='string'&&typeof value!=='number')return null;
 let raw=String(value).replace(/\s/g,'').replace(/^R\$/,'');
 if(!/^-?[0-9.,]+$/.test(raw))return null;
 if(raw.includes(','))
   raw=raw.replace(/\./g,'').replace(',','.');
 else if(/^-?\d{1,3}(?:\.\d{3})+$/.test(raw))raw=raw.replace(/\./g,'');
 if(!/^-?\d{1,12}(?:\.\d{1,8})?$/.test(raw))return null;
 if((raw.split('.')[1]||'').length>maxDecimals)return null;
 return raw;
}
export function movementClass(operation){
 if(typeof operation!=='string')return 'unknown';
 const key=operation.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
   .toLowerCase().replace(/[^a-z]/g,'');
 for(const [fragment,meaning] of Object.entries(OPS))if(key.includes(fragment))return meaning;
 return 'other';
}
export function normalizeMovement(row){
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Movimentacao invalida');
 const date=dateOf(row.data);
 const operation=publicNarrativeText(row.operacao,120);
 const quantity=officialDecimal(row.quantidade,8);
 const unitPrice=officialDecimal(row.valorUnitario,8);
 const cents=parseMoneyCents(row.valorTotal);
 if(!date||!operation||quantity===null||unitPrice===null||cents===null)
   throw Error('Movimentacao sem campos essenciais verificaveis');
 return {date,operation,type:movementClass(operation),quantity,unitPrice,cents};
}
export async function resolveItemMovements(id,seq,{
 token,limit=8,budget,request=(id,seq,page,opts)=>getCguArray(historyUrl(id,seq,page),opts)
}={}){
 historyUrl(id,seq,1);
 if(!Number.isSafeInteger(limit)||limit<1||limit>20)throw Error('Limite de historico invalido');
 const collected=[],pages=new Set();
 for(let page=1;page<=limit;page++){
   let rows;
   try{rows=await request(id,seq,page,{token,...(budget?{budget}:{})});}
   catch{return {ok:false,reason:'consulta_indisponivel'};}
   if(!Array.isArray(rows))return {ok:false,reason:'resposta_invalida'};
   if(!rows.length){
     try{return {ok:true,movements:collected.map(normalizeMovement)};}
     catch{return {ok:false,reason:'movimentacao_invalida'};}
   }
   const fingerprint=JSON.stringify(rows.map(r=>[r?.data,r?.operacao,r?.quantidade,r?.valorUnitario,r?.valorTotal]));
   if(pages.has(fingerprint))return {ok:false,reason:'pagina_repetida'};
   pages.add(fingerprint);collected.push(...rows);
 }
 return {ok:false,reason:'limite_paginacao'};
}

/** Coleção de licitações e contratações diretas publicadas pela Reitoria do IFC. */
import {REITORIA_CNPJ,monthBounds,requestPublicJSON,parseMoneyCents} from './procurement.mjs';
import {publicItemDescription} from './enrich-cgu.mjs';
import {assertPublicSafe} from './privacy.mjs';
import {MODALITIES} from '../assets/pncp-modalities.js';
import {normalizeProcess} from './procurement.mjs';

const URL='https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';
const ID=/^10635424000186-1-\d{6}\/20\d{2}$/;
function iso(value){
  if(typeof value!=='string')return null;
  const date=value.slice(0,10);
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))return null;
  const parsed=new Date(date+'T00:00:00Z');
  return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===date?date:null;
}
function tinyCode(value,max=65){
  const text=String(value??'').trim();
  return text&&text.length<=max&&/^[a-zA-Z0-9/._ -]+$/.test(text)?text:null;
}
export function noticeUrl(month,modality,page=1){
  if(!Object.hasOwn(MODALITIES,modality) || !Number.isSafeInteger(page) ||
     page<1||page>1000)throw Error('Modalidade/página PNCP inválida');
  const {start,end}=monthBounds(month);
  if(start>end)throw Error('Competência futura');
  const params=new URLSearchParams({
    dataInicial:start.replaceAll('-',''),dataFinal:end.replaceAll('-',''),
    codigoModalidadeContratacao:String(modality),
    cnpj:REITORIA_CNPJ,pagina:String(page),tamanhoPagina:'50'
  });
  return URL+'?'+params;
}
export function normalizeNotice(row,modality){
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const pncpId=row.numeroControlePNCP;
  const pub=iso(row.dataPublicacaoPncp);
  const org=String(row.orgaoEntidade?.cnpj??'').replace(/\D/g,'');
  if(typeof pncpId!=='string'||!ID.test(pncpId)||org!==REITORIA_CNPJ||
     !pub || Number(row.modalidadeId)!==Number(modality))return null;
  const notice={
    id:'pncp:'+pncpId,pncpId,source:'pncp',
    publicationUasg:'158125',month:pub.slice(0,7),
    modality:Number(modality)
  };
  const number=tinyCode(row.numeroCompra,65);
  const process=normalizeProcess(row.processo);
  const unit=tinyCode(row.unidadeOrgao?.codigoUnidade,25);
  const object=publicItemDescription(row.objetoCompra,260);
  if(number)notice.number=number;
  if(process)notice.process=process;
  if(unit)notice.unitCode=unit;
  if(object)notice.object=object;
  const estimated=parseMoneyCents(row.valorTotalEstimado);
  const homologated=parseMoneyCents(row.valorTotalHomologado);
  if(estimated!==null)notice.estimatedCents=estimated;
  if(homologated!==null)notice.homologatedCents=homologated;
  if(Number.isInteger(row.situacaoCompraId)&&row.situacaoCompraId>=0&&
     row.situacaoCompraId<=1000)notice.situation=Number(row.situacaoCompraId);
  if(typeof row.srp==='boolean')notice.srp=row.srp;
  notice.published=pub;
  return assertPublicSafe(notice);
}
export async function scanNotices(month,modality,{
  fetcher=requestPublicJSON,maxPages=20
}={}){
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>50)
    throw Error('Limite de paginação PNCP incorreto');
  const collected=[];let expected=null;const signatures=new Set();
  for(let page=1;page<=maxPages;page++){
    const body=await fetcher(noticeUrl(month,modality,page));
    const rows=Array.isArray(body?.data)?body.data:Array.isArray(body?.dados)?body.dados:null;
    const count=Number(body?.totalPaginas);
    if(!Array.isArray(rows)||!Number.isSafeInteger(count)||count<0||count>1000)
      throw Error('Envelope PNCP inválido');
    if(expected===null)expected=count;
    if(count!==expected)throw Error('Paginação PNCP inconsistente');
    if(count===0)return {records:[],skipped:0};
    if(!rows.length)throw Error('Página PNCP vazia antes do fim');
    const ids=rows.map(row=>row?.numeroControlePNCP??'');
    const signature=JSON.stringify(ids);
    if(signatures.has(signature))throw Error('Página PNCP repetida');
    signatures.add(signature);
    collected.push(...rows);
    if(page===count)break;
    if(page===maxPages)throw Error('Limite de paginação PNCP excedido');
  }
  const unique=new Map();let skipped=0;
  for(const row of collected){
    const value=normalizeNotice(row,modality);
    if(!value||value.month!==month){skipped++;continue;}
    if(unique.has(value.id)&&JSON.stringify(unique.get(value.id))!==JSON.stringify(value))
      throw Error('Edital PNCP duplicado divergente');
    unique.set(value.id,value);
  }
  return {records:[...unique.values()].sort((a,b)=>a.id.localeCompare(b.id)),skipped};
}

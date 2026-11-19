/**
 * Recuperação pontual de licitações por ID oficial PNCP conhecido em um contrato.
 * Evita varrer desnecessariamente os 14 códigos de modalidade e todos os meses.
 */
import {requestPublicJSON,HttpFailure} from './procurement.mjs';
import {normalizeNotice} from './pncp-notices.mjs';
import {MODALITIES} from '../assets/pncp-modalities.js';

const ID=/^10635424000186-1-(\d{6})\/(20\d{2})$/;
export function noticeDetailUrl(id) {
  const m=ID.exec(String(id??''));
  if(!m)throw Error('ID de contratação PNCP fora do cadastro da Reitoria');
  return 'https://pncp.gov.br/api/consulta/v1/orgaos/10635424000186/compras/'+
    m[2]+'/'+Number(m[1]);
}
export function normalizeNoticeDetail(raw,expectedId){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     raw.numeroControlePNCP!==expectedId){
    throw Error('Detalhe PNCP não corresponde à contratação solicitada');
  }
  const modality=Number(raw.modalidadeId);
  if(!Object.hasOwn(MODALITIES,modality))
    throw Error('Modalidade PNCP não reconhecida no detalhe');
  const notice=normalizeNotice(raw,modality);
  if(!notice||notice.pncpId!==expectedId)
    throw Error('Detalhe PNCP não supera validação pública');
  return notice;
}
export async function fetchNoticeDetail(id,{fetcher=requestPublicJSON}={}){
  const result=await fetcher(noticeDetailUrl(id));
  return normalizeNoticeDetail(result,id);
}
/** Respeita bloqueio HTTP 429 sem inferir que o edital inexiste. */
export async function fetchNoticeDetailWithRetry(id,{
  fetcher=requestPublicJSON,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
  for(let attempt=0;attempt<3;attempt++){
    try{return await fetchNoticeDetail(id,{fetcher});}
    catch(error){
      if(!(error instanceof HttpFailure)||error.status!==429||attempt===2)throw error;
      await wait(attempt===0?15000:30000);
    }
  }
  throw Error('PNCP não respondeu à consulta de contratação');
}
export function planMissingNotices(contracts,notices,{count=18}={}){
  const max=Number(count);
  if(!Number.isSafeInteger(max)||max<1||max>35)
    throw Error('Tamanho de lote PNCP inválido');
  const known=new Set((notices?.notices||[]).map(n=>n.pncpId));
  const pending=new Map();
  for(const c of contracts?.contracts||[]) {
    const id=c.procurementId;
    if(typeof id!=='string'||!ID.test(id)||known.has(id))continue;
    const weight=c.process?.startsWith('23349.')?0:1;
    const prev=pending.get(id);
    if(!prev||weight<prev.weight)pending.set(id,{id,weight});
  }
  return [...pending.values()].sort((a,b)=>a.weight-b.weight||
    b.id.slice(-4).localeCompare(a.id.slice(-4))||a.id.localeCompare(b.id))
    .slice(0,max).map(item=>item.id);
}

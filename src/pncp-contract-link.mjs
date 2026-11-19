/**
 * Contratos PNCP → contratação de origem por vínculo EXPLÍCITO da API oficial.
 * O detalhe do contrato entrega numeroControlePncpCompra (grafia real, P minúsculo).
 * Não usa processo, CNPJ do fornecedor, UASG publicadora ou semelhança de valores.
 */
import {requestPublicJSON} from './procurement.mjs';
import {assessContractAttribution} from '../assets/procurement-links.js';

const CONTRACT=/^(\d{14})-2-(\d{6})\/(20\d{2})$/;
const PURCHASE=/^\d{14}-1-\d{6}\/20\d{2}$/;
export function contractDetailUrl(pncpId){
  const id=CONTRACT.exec(String(pncpId??''));
  if(!id||!['10635424000186','10635424000348'].includes(id[1]))
    throw Error('Identificador de contrato PNCP fora do IFC');
  return 'https://pncp.gov.br/api/pncp/v1/orgaos/'+id[1]+'/contratos/'+
    id[3]+'/'+Number(id[2]);
}
export function normalizeContractPurchaseLink(response,expectedId){
  if(!response||typeof response!=='object'||Array.isArray(response)||
     response.numeroControlePNCP!==expectedId) {
    throw Error('Resposta PNCP não corresponde ao contrato solicitado');
  }
  // O manual usa PNCP maiúsculo; o retorno real utiliza "Pncp".
  const raw=response.numeroControlePncpCompra??response.numeroControlePNCPCompra;
  if(raw==null||raw==='')return {status:'not_reported'};
  if(typeof raw!=='string'||!PURCHASE.test(raw))
    throw Error('Referência PNCP de contratação inválida');
  return {status:'linked',procurementId:raw};
}
export async function fetchContractPurchaseLink(contract,{fetcher=requestPublicJSON}={}){
  if(contract?.source!=='pncp')throw Error('Apenas contratos PNCP');
  const response=await fetcher(contractDetailUrl(contract.pncpId));
  return normalizeContractPurchaseLink(response,contract.pncpId);
}
export function planContractPurchaseLinks(catalog,{
  count=12,now=new Date(),recheck=false
}={}){
  const limit=Number(count);
  if(!Number.isSafeInteger(limit)||limit<1||limit>40)
    throw Error('Tamanho de lote inválido');
  const candidates=(catalog?.contracts||[]).filter(c=>c.source==='pncp');
  const due=c=>{
    if(recheck)return true;
    if(c.procurementLinkStatus==='linked')return false;
    if(c.procurementLinkStatus==='not_reported'){
      const since=new Date((c.procurementLinkAt||'')+'T00:00:00Z').getTime();
      return !Number.isFinite(since)||now.getTime()-since>=30*86400000;
    }
    if(c.procurementLinkStatus==='unavailable'){
      const since=new Date((c.procurementLinkAt||'')+'T00:00:00Z').getTime();
      return !Number.isFinite(since)||now.getTime()-since>=7*86400000;
    }
    return !c.procurementId;
  };
  return candidates.filter(due).sort((a,b)=>{
    const weight=c=>{
      if(c.process?.startsWith('23349.'))return 0;
      const level=assessContractAttribution(c).level;
      if(level==='confirmed'||level==='ne_indication'||level==='context')return 1;
      return 2;
    };
    return weight(a)-weight(b)||b.publishedMonth.localeCompare(a.publishedMonth)||
      a.id.localeCompare(b.id);
  }).slice(0,limit).map(c=>({id:c.id,pncpId:c.pncpId}));
}

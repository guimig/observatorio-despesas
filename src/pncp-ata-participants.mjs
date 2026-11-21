/** Evidencias de participacao em ARP: nao implicam empenho nem compra. */
import {ataUrl} from './pncp-atas.mjs';
import {requestPublicJSON,CAMPUS_CNPJ,CAMPUS_UG} from './procurement.mjs';
import {assertPublicSafe} from './privacy.mjs';
const validRole=new Set([1,2,3]);
export function participantsUrl(ata){
 if(!Number.isSafeInteger(ata?.sequence)||ata.sequence<1)throw Error('Ata invalida');
 return ataUrl(ata.procurementId)+'/'+ata.sequence+'/partesenvolvidas';
}
export function normalizeParticipants(body){
 const rows=Array.isArray(body)?body:Array.isArray(body?.data)?body.data:
  Array.isArray(body?.dados)?body.dados:null;
 if(!rows)throw Error('Resposta de partes invalida');
 if(!Array.isArray(body)){
  const pages=Number(body.totalPaginas??1),total=Number(body.totalRegistros??rows.length);
  if(!((pages===0&&total===0&&rows.length===0)||
       (pages===1&&total===rows.length)))throw Error('Partes paginadas: nao gravar resultado parcial');
 }
 if(rows.length>1000)throw Error('Limite de partes excedido');
 const roles=new Set();
 for(const row of rows){
  const role=Number(row?.tipoParteEnvolvida?.id??row?.tipoParteEnvolvidaId);
  const cnpj=String(row?.orgao?.cnpj??row?.cnpj??'').replace(/\D/g,'');
  const unit=String(row?.unidade?.codigo??row?.codigoUnidadeCompradora??'').trim();
  // Evidencia somente quando CNPJ do campus E codigo da unidade coincidem.
  if(cnpj===CAMPUS_CNPJ&&unit===CAMPUS_UG&&validRole.has(role))roles.add(role);
 }
 return assertPublicSafe({campusRoles:[...roles].sort((a,b)=>a-b),
  checkedComplete:true});
}
export async function scanParticipants(ata,{fetcher=requestPublicJSON}={}){
 return normalizeParticipants(await fetcher(participantsUrl(ata)));
}

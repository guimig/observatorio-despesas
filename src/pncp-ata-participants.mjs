/** Evidencias de participacao em ARP: nao implicam empenho nem compra. */
import {ataUrl} from './pncp-atas.mjs';
import {requestPublicJSON,CAMPUS_CNPJ,CAMPUS_UG,REITORIA_CNPJ} from './procurement.mjs';
import {assertPublicSafe} from './privacy.mjs';
const REITORIA_UG='158125';
const validRole=new Set([1,2,3]);
const cNPJUnknown=cnpj=>cnpj!==CAMPUS_CNPJ&&cnpj!==REITORIA_CNPJ;
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
 const shape={rows:rows.length,roleObject:0,roleScalar:0,orgaoObject:0,cnpjTop:0,
  unidadeObject:0,unidadeCode:0,unitTop:0,matchedCnpj:0,matchedUnit:0,
  matchedBoth:0,recognizedRole:0,nonemptyCnpj:0,nonemptyUnit:0,
  reitoriaCnpj:0,reitoriaUnit:0,otherCnpj:0,otherUnit:0};
 for(const row of rows){
  const role=Number(row?.tipoParteEnvolvida?.id??row?.tipoParteEnvolvidaId);
  const cnpj=String(row?.orgao?.cnpj??row?.cnpj??'').replace(/\D/g,'');
  const unit=String(row?.unidade?.codigo??row?.codigoUnidadeCompradora??'').trim();
  if(row?.tipoParteEnvolvida&&typeof row.tipoParteEnvolvida==='object')shape.roleObject++;
  if(row?.tipoParteEnvolvidaId!==undefined)shape.roleScalar++;
  if(row?.orgao&&typeof row.orgao==='object')shape.orgaoObject++;
  if(row?.cnpj!==undefined)shape.cnpjTop++;
  if(row?.unidade&&typeof row.unidade==='object')shape.unidadeObject++;
  if(row?.unidade?.codigo!==undefined)shape.unidadeCode++;
  if(row?.codigoUnidadeCompradora!==undefined)shape.unitTop++;
  if(cnpj)shape.nonemptyCnpj++;
  if(unit)shape.nonemptyUnit++;
  if(cnpj===REITORIA_CNPJ)shape.reitoriaCnpj++;
  if(unit===REITORIA_UG)shape.reitoriaUnit++;
  if(cnpj&&cNPJUnknown(cnpj))shape.otherCnpj++;
  if(unit&&unit!==CAMPUS_UG&&unit!==REITORIA_UG)shape.otherUnit++;
  if(cnpj===CAMPUS_CNPJ)shape.matchedCnpj++;
  if(unit===CAMPUS_UG)shape.matchedUnit++;
  if(cnpj===CAMPUS_CNPJ&&unit===CAMPUS_UG)shape.matchedBoth++;
  if(validRole.has(role))shape.recognizedRole++;
  // Evidencia somente quando CNPJ do campus E codigo da unidade coincidem.
  if(cnpj===CAMPUS_CNPJ&&unit===CAMPUS_UG&&validRole.has(role))roles.add(role);
 }
 return assertPublicSafe({campusRoles:[...roles].sort((a,b)=>a-b),
  checkedComplete:true,shape});
}
export async function scanParticipants(ata,{fetcher=requestPublicJSON}={}){
 return normalizeParticipants(await fetcher(participantsUrl(ata)));
}

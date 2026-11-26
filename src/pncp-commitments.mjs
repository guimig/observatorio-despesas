/**
 * Consulta de empenhos vinculados a instrumento PNCP (API de integração).
 * Somente números contendo explicitamente UG 158459 são retidos.
 * Campo numeroContratoEmpenho NÃO é presumido como NE SIAFI completa.
 */
import { requestPublicJSON } from './procurement.mjs';
import { extractAraquariNeEvidence } from '../assets/procurement-links.js';
import {extractCommitmentMetadata} from './pncp-commitment-fields.mjs';

const PNCP=/^(\d{14})-2-(\d{6})\/(20\d{2})$/;
const BASE='https://pncp.gov.br/api/pncp/v1/orgaos';
export function linkedCommitmentsUrl(pncpId,page=1){
  const m=PNCP.exec(String(pncpId??''));
  if(!m||!Number.isSafeInteger(page)||page<1||page>1000) {
    throw Error('Identificador contratual ou página inválido');
  }
  return BASE+'/'+m[1]+'/contratos/'+m[3]+'/'+Number(m[2])+
    '/empenhos?'+new URLSearchParams({pagina:String(page),tamanhoPagina:'50'});
}
export function extractCommitmentRefs(records){
  if(!Array.isArray(records))throw Error('Resposta PNCP de empenhos inválida');
  const found=new Set();
  for(const row of records){
    const raw=row?.numeroEmpenho;
    if(typeof raw!=='string')continue;
    const verified=extractAraquariNeEvidence(raw);
    if(!verified)continue;
    if(verified.kind==='full')found.add(verified.ne);
    // Registro contém UG, ano e NE mas não gestão: preserva forma canônica
    // distinta do ID integral CGU, sem inventar código de gestão.
    if(verified.kind==='ug_short')found.add('158459'+verified.short);
  }
  return [...found].sort();
}
export async function fetchLinkedCommitments(contract,{
  fetcher=requestPublicJSON,maxPages=5,includeDetails=false
}={}){
  if(contract?.source!=='pncp')throw Error('Somente contratos PNCP');
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>30)
    throw Error('Limite de páginas incorreto');
  const rows=[];let expected=null,expectedRecords=null;const seen=new Set();
  const done=()=>({refs:extractCommitmentRefs(rows),count:rows.length,
    ...(includeDetails?extractCommitmentMetadata(rows,contract):{})});
  for(let page=1;page<=maxPages;page++){
    const response=await fetcher(linkedCommitmentsUrl(contract.pncpId,page));
    if(!response||typeof response!=='object'||Array.isArray(response)||
       !Array.isArray(response.data)){
      throw Error('Resposta PNCP de empenhos sem data');
    }
    const total=Number(response.totalPaginas);
    if(!Number.isSafeInteger(total)||total<0||total>1000) {
      throw Error('Paginação PNCP de empenhos desconhecida');
    }
    if(expected===null)expected=total;
    if(total!==expected)throw Error('Contagem PNCP alterada durante consulta');
    if(response.totalRegistros!==undefined){
      const n=Number(response.totalRegistros);
      if(!Number.isSafeInteger(n)||n<0||n>50000||(expectedRecords!==null&&n!==expectedRecords))
        throw Error('Total de registros de empenhos PNCP inconsistente');
      expectedRecords=n;
    }
    if(total===0){
      if(response.data.length||expectedRecords>0)throw Error('Resposta vazia contraditoria');
      return done();
    }
    if(!response.data.length)throw Error('Página de empenhos vazia antes do fim');
    const ids=response.data.map(row=>String(row?.sequencialEmpenho??'')+':'+String(row?.numeroEmpenho??''));
    const fp=JSON.stringify(ids);
    if(seen.has(fp))throw Error('Página de empenhos duplicada');
    seen.add(fp);
    rows.push(...response.data);
    if(page===total){
      if(expectedRecords!==null&&expectedRecords!==rows.length)throw Error('Total PNCP de empenhos divergente');
      return done();
    }
  }
  throw Error('Paginação de empenhos incompleta');
}

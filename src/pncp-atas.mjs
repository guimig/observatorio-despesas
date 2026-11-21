/** Atas PNCP vinculadas por ID oficial de compra; sem inferir empenhos. */
import {requestPublicJSON,REITORIA_CNPJ} from './procurement.mjs';
import {assertPublicSafe} from './privacy.mjs';
const PURCHASE=/^(\d{14})-1-(\d{6})\/(20\d{2})$/;
const date=v=>{
 const s=typeof v==='string'?v.slice(0,10):'';
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(s))return null;
 const d=new Date(s+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null;
};
export function ataUrl(pncpId){
 const m=PURCHASE.exec(pncpId||'');
 if(!m||m[1]!==REITORIA_CNPJ)throw Error('Compra PNCP nao autorizada');
 return 'https://pncp.gov.br/api/pncp/v1/orgaos/'+m[1]+
  '/compras/'+m[3]+'/'+Number(m[2])+'/atas';
}
export function normalizeAta(row,pncpId){
 if(!row||typeof row!=='object'||Array.isArray(row))return null;
 ataUrl(pncpId);
 const seq=Number(row.sequencialAta);
 if(!Number.isSafeInteger(seq)||seq<1)return null;
 const record={id:pncpId+':ata:'+seq,procurementId:pncpId,
  source:'pncp',sequence:seq};
 const number=String(row.numeroAtaRegistroPreco??'').trim();
 if(number&&number.length<=50&&/^[a-zA-Z0-9/._ -]+$/.test(number))
  record.number=number;
 for(const [src,dst] of [['dataAssinatura','signed'],
  ['dataVigenciaInicio','starts'],['dataVigenciaFim','ends'],
  ['dataPublicacaoPncp','published'],['dataCancelamento','cancelledAt']]){
  const value=date(row[src]);if(value)record[dst]=value;
 }
 if(typeof row.cancelado==='boolean')record.cancelled=row.cancelado;
 if(typeof row.possibilidadeAdesao==='boolean')record.allowsAdhesion=row.possibilidadeAdesao;
 return assertPublicSafe(record);
}
export async function scanAtas(notice,{fetcher=requestPublicJSON}={}){
 if(notice?.srp!==true)throw Error('Consulta de atas exige SRP');
 const url=ataUrl(notice.pncpId);
 const body=await fetcher(url);
 // Aceitar lista direta ou envelope completo, nunca pagina parcial.
 const rows=Array.isArray(body)?body:body&&Array.isArray(body.data)?body.data:null;
 if(!rows)throw Error('Resposta de atas nao e lista completa');
 if(!Array.isArray(body)){
  const pages=Number(body.totalPaginas??1);
  const total=Number(body.totalRegistros??rows.length);
  if(!Number.isSafeInteger(pages)||pages!==1||
     !Number.isSafeInteger(total)||total!==rows.length)
   throw Error('Consulta de atas paginada ou incompleta');
 }
 if(rows.length>1000)throw Error('Resposta de atas acima do limite');
 const records=new Map();
 for(const row of rows){
  const record=normalizeAta(row,notice.pncpId);
  if(!record)throw Error('Ata sem sequencial valido; nao gravar resultado parcial');
  if(records.has(record.id))throw Error('Ata duplicada na resposta');
  records.set(record.id,record);
 }
 return [...records.values()].sort((a,b)=>a.sequence-b.sequence);
}

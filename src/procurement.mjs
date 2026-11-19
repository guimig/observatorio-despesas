/** Fontes públicas de contratos, com escopos separados IFC x Campus Araquari. */
import { parseMoneyCents } from './cgu.mjs';
import { publicItemDescription } from './enrich-cgu.mjs';
import { assertPublicSafe, maskCpf } from './privacy.mjs';
export { matchDocumentContract } from '../assets/procurement-links.js';

export const CAMPUS_UG='158459';
export const CAMPUS_CNPJ='10635424000348';
export const REITORIA_CNPJ='10635424000186';
const PNCP='https://pncp.gov.br/api/consulta/v1/contratos';
const COMPRAS='https://dadosabertos.compras.gov.br';
const PNCP_ID=/^\d{14}-[1-9]-\d{6}\/20\d{2}$/;
const VALID_MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const PROCESS=/^\d{5}\.\d{6}\/20\d{2}-\d{2}$/;

function intRange(value,fallback,max){
  const n=Number(value??fallback);
  if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('Parâmetro numérico inválido');
  return n;
}
function text(value,max=90){
  if(typeof value!=='string')return null;
  const t=value.trim();
  return t.length>0&&t.length<=max ? t:null;
}
function code(value,max=90){
  const t=text(String(value??''),max);
  return t&&/^[A-Za-z0-9_./ -]+$/.test(t)?t:null;
}
function iso(value){
  const s=typeof value==='string'?value.slice(0,10):'';
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(s))return null;
  const d=new Date(s+'T00:00:00Z');
  return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s?s:null;
}
function cnpj(value){
  const s=String(value??'').replace(/\D/g,'');
  return s.length===14?s:null;
}
function supplier(row,rawCode,typeField,nameField){
  const raw=String(row?.[rawCode]??'').trim();
  const digits=raw.replace(/\D/g,'');
  const type=String(row?.[typeField]??'').toUpperCase().trim();
  if(digits.length===14&&type!=='PF'){
    const name=publicItemDescription(row?.[nameField],150);
    return {supplierCnpj:digits,...(name?{supplierName:name}:{})};
  }
  if((digits.length===11||/^\*\*\*\.\d{3}\.\d{3}-\*\*$/.test(raw))&&type!=='PJ'){
    return {supplierCpfMasked:maskCpf(raw)};
  }
  return {};
}
function processo(raw){
  const s=code(raw,50);
  return s&&PROCESS.test(s)?s:null;
}
function amount(value){
  const cents=parseMoneyCents(value);
  return cents===null?undefined:cents;
}
export function monthBounds(month,now=new Date()){
  if(!VALID_MONTH.test(month))throw Error('Competência inválida');
  const [year,number]=month.split('-').map(Number);
  const end=new Date(Date.UTC(year,number,0)).toISOString().slice(0,10);
  const today=new Date(now).toISOString().slice(0,10);
  const finish=end>today?today:end;
  return {start:month+'-01',end:finish};
}
export function pncpUrl(month,cnpjOrgao,page=1){
  if(![REITORIA_CNPJ,CAMPUS_CNPJ].includes(cnpjOrgao))
    throw Error('CNPJ institucional não autorizado');
  const {start,end}=monthBounds(month);
  if(start>end)throw Error('Competência futura não consultável');
  const params=new URLSearchParams({
    dataInicial:start.replaceAll('-',''),dataFinal:end.replaceAll('-',''),
    cnpjOrgao,pagina:String(intRange(page,1,1000)),tamanhoPagina:'100'
  });
  return PNCP+'?'+params;
}
export function uasgUrl(){
  return COMPRAS+'/modulo-uasg/1_consultarUasg?'+
    new URLSearchParams({codigoUasg:CAMPUS_UG,pagina:'1',tamanhoPagina:'10'});
}
export function comprasUrl(orgao,month,page=1){
  if(!/^\d{3,9}$/.test(String(orgao)))throw Error('Código de órgão não validado');
  const {start,end}=monthBounds(month);
  const params=new URLSearchParams({
    codigoOrgao:String(orgao),codigoUnidadeGestora:CAMPUS_UG,
    dataVigenciaInicialMin:start,dataVigenciaInicialMax:end,
    pagina:String(intRange(page,1,1000)),tamanhoPagina:'100'
  });
  return COMPRAS+'/modulo-contratos/1_consultarContratos?'+params;
}
export class HttpFailure extends Error {
  constructor(status){super('API HTTP '+status);this.status=status;}
}
export async function requestPublicJSON(url,{fetcher=fetch,wait=async ms=>new Promise(r=>setTimeout(r,ms))}={}){
  // URL é construída internamente; nenhuma resposta bruta é incluída em erros.
  if(typeof url!=='string'||!url.startsWith('https://')||
     !([new URL(PNCP).hostname,new URL(COMPRAS).hostname].includes(new URL(url).hostname))){
    throw Error('Host externo não autorizado');
  }
  for(let attempt=0;attempt<3;attempt++){
    let response;
    try{
      response=await fetcher(url,{headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(18000)});
    }catch{
      if(attempt===2)throw new HttpFailure(0);
      await wait(850*(attempt+1));continue;
    }
    if([429,500,502,503,504].includes(response.status)&&attempt<2){
      await wait(1100*(attempt+1));continue;
    }
    if(response.status===204)return {dados:[],totalPaginas:0};
    if(!response.ok)throw new HttpFailure(response.status);
    try{return await response.json();}
    catch{throw Error('Formato JSON externo inválido');}
  }
  throw new HttpFailure(0);
}
export function normalizePncp(row){
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const id=text(row.numeroControlePNCP,60);
  const org=cnpj(row.orgaoEntidade?.cnpj);
  const published=iso(row.dataPublicacaoPncp);
  if(!PNCP_ID.test(id??'') || ![CAMPUS_CNPJ,REITORIA_CNPJ].includes(org) || !published)
    return null;
  const unit=code(row.unidadeOrgao?.codigoUnidade,25);
  const scope=(org===CAMPUS_CNPJ || unit===CAMPUS_UG)?'campus':'ifc';
  const contract={
    id:'pncp:'+id,source:'pncp',scope,orgCnpj:org,
    publishedMonth:published.slice(0,7),number:code(row.numeroContratoEmpenho,65),
    pncpId:id,procurementId:PNCP_ID.test(String(row.numeroControlePNCPCompra??''))?
      row.numeroControlePNCPCompra:null,
    process:processo(row.processo),unitCode:unit,
    signed:iso(row.dataAssinatura),starts:iso(row.dataVigenciaInicio),
    ends:iso(row.dataVigenciaFim),amountCents:amount(row.valorGlobal)
  };
  const vendor=supplier(row,'niFornecedor','tipoPessoa','nomeRazaoSocialFornecedor');
  Object.assign(contract,vendor);
  const object=publicItemDescription(row.objetoContrato,260);
  if(object)contract.object=object;
  const kind=publicItemDescription(row.tipoContrato?.nome,80);
  if(kind)contract.kind=kind;
  return assertPublicSafe(Object.fromEntries(Object.entries(contract)
    .filter(([,v])=>v!==null&&v!==undefined)));
}
export function normalizeCompras(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     String(row.codigoUnidadeGestora??'')!==CAMPUS_UG)return null;
  const number=code(row.numeroContrato,65);
  const starts=iso(row.dataVigenciaInicial);
  if(!number||!starts)return null;
  // Chave formada por UG+numero do instrumento, que deve incluir o exercício.
  // Se o número não identificar o exercício, usa início da vigência para evitar
  // colisões sem presumir identificador único fornecido pela API.
  const year=/\/(20\d{2})$/.exec(number)?.[1]||starts.slice(0,4);
  const id='compras:'+CAMPUS_UG+':'+year+':'+number.replaceAll(' ','');
  const contract={id,source:'compras',scope:'campus',publishedMonth:starts.slice(0,7),
    number,unitCode:CAMPUS_UG,process:processo(row.processo),
    starts,ends:iso(row.dataVigenciaFinal),amountCents:amount(row.valorGlobal)};
  Object.assign(contract,supplier(row,'niFornecedor','tipoPessoaFornecedor','nomeRazaoSocialFornecedor'));
  const object=publicItemDescription(row.objeto,260);
  if(object)contract.object=object;
  const kind=publicItemDescription(row.nomeTipo,80);
  if(kind)contract.kind=kind;
  return assertPublicSafe(Object.fromEntries(Object.entries(contract)
    .filter(([,v])=>v!==null&&v!==undefined)));
}
function pages(body){
  if(!body || typeof body!=='object' || Array.isArray(body) ||
    !Array.isArray(body.dados) && !Array.isArray(body.resultado))throw Error('Envelope de paginação inválido');
  const rows=body.dados??body.resultado;
  const total=Number(body.totalPaginas);
  if(!Number.isSafeInteger(total)||total<0||total>1000)throw Error('Contagem de páginas desconhecida');
  return {rows,total};
}
export async function paginate(makeUrl,{fetcher=requestPublicJSON,maxPages=15}={}){
  const limit=intRange(maxPages,15,40),collected=[],seen=new Set();
  let total=null;
  for(let page=1;page<=limit;page++){
    const body=await fetcher(makeUrl(page));
    const p=pages(body);
    if(total===null)total=p.total;
    if(total!==p.total)throw Error('Quantidade de páginas mudou durante a consulta');
    if(total===0)return [];
    if(p.rows.length===0)throw Error('Página sem registros antes do término');
    // Sem registros duplicados do mesmo lote sob paginação.
    const signature=JSON.stringify(p.rows.map(row=>row?.numeroControlePNCP??
      row?.numeroContrato??''));
    if(seen.has(signature))throw Error('Página duplicada');
    seen.add(signature);
    collected.push(...p.rows);
    if(page===total)return collected;
  }
  throw Error('Paginação incompleta: limite excedido');
}
export async function scanPncp(month,{fetcher=requestPublicJSON,maxPages=15}={}){
  const records=[],skipped=[];
  for(const org of [CAMPUS_CNPJ,REITORIA_CNPJ]){
    const batch=await paginate(page=>pncpUrl(month,org,page),{fetcher,maxPages});
    for(const row of batch){
      const value=normalizePncp(row);
      if(!value || value.publishedMonth!==month){skipped.push(1);continue;}
      records.push(value);
    }
  }
  const unique=new Map();
  for(const contract of records){
    if(unique.has(contract.id) &&
       JSON.stringify(unique.get(contract.id))!==JSON.stringify(contract)) {
      throw Error('Contrato PNCP duplicado com divergência');
    }
    unique.set(contract.id,contract);
  }
  return {records:[...unique.values()],skipped:skipped.length};
}
export async function scanCompras(month,{fetcher=requestPublicJSON,maxPages=15}={}){
  const result=await fetcher(uasgUrl());
  const units=pages(result).rows;
  const unit=units.find(u=>String(u.codigoUasg??'')===CAMPUS_UG);
  const org=unit?.codigoOrgao;
  if(!/^\d{3,9}$/.test(String(org??'')))throw Error('Código do órgão não confirmado pela UASG');
  const batch=await paginate(page=>comprasUrl(org,month,page),{fetcher,maxPages});
  const valid=[],skipped=[];
  for(const row of batch){
    const value=normalizeCompras(row);
    if(!value || value.publishedMonth!==month){skipped.push(1);continue;}
    valid.push(value);
  }
  return {records:valid,skipped:skipped.length};
}
export function normalizeProcess(value){
  return processo(value);
}

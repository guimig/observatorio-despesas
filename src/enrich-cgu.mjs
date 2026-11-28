/**
 * Enriquecimento incremental CGU.
 * Nunca registra respostas brutas, CPF, favorecidos ou observações textuais.
 */
import { getCguArray, parseMoneyCents } from './cgu.mjs';
import { sanitizeText, assertPublicSafe } from './privacy.mjs';
import {publicNarrativeText} from './public-narrative.mjs';
import {IMPACT_FIELDS,aggregateImpactComponents} from './rap-evidence.mjs';

const BASE='https://api.portaldatransparencia.gov.br/api-de-dados/despesas';
const DOC=/^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/;
const NE=/^158459\d{5}20\d{2}NE\d{6}$/;

function bounded(value,fallback,max){
  const n=Number(value??fallback);
  if(!Number.isSafeInteger(n)||n<1||n>max) throw Error('Limite CGU inválido');
  return n;
}
export function liquidationUrl(document,page=1){
  if(!DOC.test(document)||!Number.isSafeInteger(page)||page<1)
    throw Error('Documento de liquidação inválido');
  return BASE+'/empenhos-impactados?'+new URLSearchParams({
    codigoDocumento:document,fase:'2',pagina:String(page)
  });
}
export function paymentUrl(document,page=1){
  if(!DOC.test(document)||!Number.isSafeInteger(page)||page<1) throw Error('Documento de pagamento inválido');
  return BASE+'/empenhos-impactados?'+new URLSearchParams({
    codigoDocumento:document,fase:'3',pagina:String(page)
  });
}
export function itemsUrl(document,page=1){
  if(!NE.test(document)||!Number.isSafeInteger(page)||page<1) throw Error('Empenho inválido');
  return BASE+'/itens-de-empenho?'+new URLSearchParams({
    codigoDocumento:document,pagina:String(page)
  });
}
export function requestLiquidationPage(document,page,options){
  return getCguArray(liquidationUrl(document,page),options);
}
export function requestPaymentPage(document,page,options){
  return getCguArray(paymentUrl(document,page),options);
}
export function requestItemsPage(document,page,options){
  return getCguArray(itemsUrl(document,page),options);
}

function recordFingerprint(rows,keys){
  return JSON.stringify(rows.map(row=>keys.map(key=>row?.[key]??null)));
}
export function classifyCguFailure(error){
  const message=String(error?.message||'');
  const status=/^CGU HTTP (\d{3})$/.exec(message);
  if(status){
    const code=Number(status[1]);
    if(code===429||code>=500)return 'consulta_indisponivel';
    if(code===401||code===403)return 'acesso_negado';
    if(code===404)return 'recurso_nao_encontrado';
    return 'erro_http';
  }
  if(message.includes('JSON inesperado')||message.includes('formato diferente de lista'))
    return 'resposta_invalida';
  return 'consulta_indisponivel';
}
async function collectPages(document,{token,limit=8,request,keys,budget}){
  const max=bounded(limit,8,20), pages=new Set(),result=[];
  for(let page=1;page<=max;page++){
    let rows;
    try{rows=await request(document,page,{token,...(budget?{budget}:{})});}
    catch(error){return {ok:false,reason:classifyCguFailure(error)};}
    if(!Array.isArray(rows))return {ok:false,reason:'resposta_invalida'};
    if(!rows.length)return {ok:true,rows:result};
    const signature=recordFingerprint(rows,keys);
    if(pages.has(signature))return {ok:false,reason:'pagina_repetida'};
    pages.add(signature);
    result.push(...rows);
  }
  return {ok:false,reason:'limite_paginacao'};
}
function attachImpactComponents(links,rows){
  const groups=new Map();
  for(const row of rows){
    const id=typeof row?.empenho==='string'?row.empenho:row?.empenho?.documento;
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(row);
  }
  return links.map(link=>({...link,impactComponents:aggregateImpactComponents(groups.get(link.to)||[])}));
}
function paymentComponents(row){
  const regular=parseMoneyCents(row?.valorPago);
  const rap=parseMoneyCents(row?.valorRestoPago);
  if(regular===null&&rap===null)return null;
  const cents=(regular??0)+(rap??0);
  return Number.isSafeInteger(cents)?cents:null;
}
export async function resolvePaymentLinks(document,{token,limit=8,request=requestPaymentPage,budget,includeRapComponents=false}={}){
  if(!DOC.test(document))throw Error('Documento de pagamento inválido');
  const response=await collectPages(document,{token,limit,request,budget,
    keys:['empenho','subitem',...Object.values(IMPACT_FIELDS)]});
  if(!response.ok)return {ok:false,reason:response.reason};
  const sums=new Map();
  for(const row of response.rows){
    const cents=paymentComponents(row);
    const id=String(row?.empenho??'');
    if(!NE.test(id)||cents===null)return {ok:false,reason:'impacto_nao_identificado'};
    const next=(sums.get(id)??0)+cents;
    if(!Number.isSafeInteger(next))return {ok:false,reason:'valor_fora_limite'};
    sums.set(id,next);
  }
  const links=[...sums.entries()].sort(([a],[b])=>a.localeCompare(b))
    .map(([to,cents])=>({from:document,to,cents}));
  return {ok:true,links:includeRapComponents?attachImpactComponents(links,response.rows):links,impacts:response.rows.length};
}

/**
 * Relaciona todos os documentos de fase 2 às NEs impactadas, independentemente
 * do valor documental. Falha fechada se um impacto ou uma página for inválida.
 * O valor do documento de liquidação nunca é sobrescrito pela soma de impactos.
 */
export async function resolveLiquidationLinks(document,{
  token,limit=8,request=requestLiquidationPage,budget,includeRapComponents=false
}={}){
  if(!DOC.test(document))throw Error('Documento de liquidação inválido');
  const response=await collectPages(document,{token,limit,request,budget,
    keys:['empenho','subitem',...Object.values(IMPACT_FIELDS)]});
  if(!response.ok)return {ok:false,reason:response.reason};
  const sums=new Map();
  for(const row of response.rows){
    const id=typeof row?.empenho==='string'?row.empenho:row?.empenho?.documento;
    const cents=parseMoneyCents(row?.valorLiquidado);
    if(!NE.test(id??'')||cents===null)
      return {ok:false,reason:'impacto_nao_identificado'};
    const next=(sums.get(id)??0)+cents;
    if(!Number.isSafeInteger(next))return {ok:false,reason:'valor_fora_limite'};
    sums.set(id,next);
  }
  const links=[...sums.entries()].sort(([a],[b])=>a.localeCompare(b))
    .map(([to,cents])=>({from:document,to,cents}));
  return {ok:true,links:includeRapComponents?attachImpactComponents(links,response.rows):links,impacts:response.rows.length};
}

/**
 * Descrição é livre: a versão pública só preserva texto que não pareça conter
 * e-mail, dados bancários, identificadores pessoais ou telefone.
 * CPF no texto é mascarado ANTES da avaliação; se permanecer contexto pessoal,
 * suprime a descrição inteira, sem salvar cópia bruta.
 */
export function publicItemDescription(value,max=260){
  if(typeof value!=='string')return null;
  const raw=value.trim();
  if(!raw||raw.length>max||/[\u0000-\u001f\u007f]/.test(raw))return null;
  const clean=sanitizeText(raw).replace(/\s+/g,' ').trim();
  if(!clean||clean.length>max)return null;
  if(/@|https?:\/\/|www\.|(?:\+?\d[\s().-]*){10,}/i.test(clean)||
     /\b(CPF|RG|PIS|NIS|matr[ií]cula|conta\s+corrente|ag[eê]ncia\s+banc[aá]ria|endere[cç]o\s+residencial)\b/i.test(clean)){
    return null;
  }
  return assertPublicSafe(clean);
}
export function normalizeItem(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Item CGU inválido');
  const seq=Number(row.sequencial);
  if(!Number.isSafeInteger(seq)||seq<1||seq>100000)throw Error('Sequência do item inválida');
  const item={seq};
  const code=String(row.codigoItemEmpenho??'').trim();
  if(/^[\w./-]{1,80}$/.test(code))item.code=code;
  const sub=String(row.codigoSubelemento??'').trim();
  if(/^[\w./-]{1,20}$/.test(sub))item.sub=sub;
  const subdesc=publicItemDescription(row.descricaoSubelemento,110);
  if(subdesc)item.subdesc=subdesc;
  const description=publicNarrativeText(row.descricao,5000);
  if(description){
    const found=/^Item compra:\s*(\d{1,8})\s*-\s*([\s\S]+)$/i.exec(description);
    if(found){item.purchaseItem=found[1];item.description=found[2].trim();}
    else item.description=description;
  }
  const cents=parseMoneyCents(row.valorAtual);
  if(cents!==null)item.cents=cents;
  return assertPublicSafe(item);
}
export async function resolveItems(document,{token,limit=8,request=requestItemsPage,budget}={}){
  if(!NE.test(document))throw Error('Empenho inválido');
  const result=await collectPages(document,{token,limit,request,budget,
    keys:['codigoItemEmpenho','sequencial','valorAtual','descricao']});
  if(!result.ok)return {ok:false,reason:result.reason};
  const items=new Map();
  try{
    for(const row of result.rows){
      const item=normalizeItem(row);
      if(items.has(item.seq)&&JSON.stringify(items.get(item.seq))!==JSON.stringify(item)){
        return {ok:false,reason:'sequencial_duplicado_divergente'};
      }
      items.set(item.seq,item);
    }
  }catch{return {ok:false,reason:'item_invalido'};}
  return {ok:true,items:[...items.values()].sort((a,b)=>a.seq-b.seq)};
}

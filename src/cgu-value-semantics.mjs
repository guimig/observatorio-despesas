/** Hipoteses de semantica monetaria, nao novas regras de contabilizacao.
 * Dicionario CSV CGU: https://portaldatransparencia.gov.br/dicionario-de-dados/empenhos
 * API: https://api.portaldatransparencia.gov.br/swagger-ui/index.html
 * O dicionario do CSV nao prova a semantica de valor na API.
 * Somente classes/contagens podem sair para logs; nenhum dado canonico e alterado. */
import {indexCommitmentChronology,commitmentChronologyEvidence,reconcileSiafiItem} from '../assets/siafi-movement-reconciliation.js';
import {validDay} from './operational-state.mjs';
import {parseMoneyCents,requestDocuments} from './cgu.mjs';
import {summarizeOriginalIssueFields} from './recover-cgu-originals.mjs';

export const MEASURES=Object.freeze(['initial','issue_year_net','net_before_cancellations','updated']);
const increment=(map,key)=>{map[key]=(map[key]||0)+1};
const validAmount=x=>Number.isSafeInteger(x)&&x>=0;
const reference=record=>[{date:record.owners[0].doc.date,cents:record.owners[0].doc.cents},
 ...record.observations].sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
const signed=m=>(m.type==='original'||m.type==='reinforcement'?1n:-1n)*BigInt(m.cents);

/** Todos os itens precisam ser conhecidos, unicos e conciliados com o valorAtual.
 * As medidas sao reconstrucoes aritmeticas, nao saldos contabilisticos. */
export function reconstructValueMeasures(record,items,{today}={}){
 if(!record||record.owners?.length!==1||!validDay(today)||
    !Array.isArray(items)||!items.length)return {status:'unavailable',measures:null};
 if(items.some(i=>!Number.isSafeInteger(i.seq)||i.seq<1||!validAmount(i.cents))||
    new Set(items.map(i=>i.seq)).size!==items.length)return {status:'invalid_catalog',measures:null};
 const year=record.id.slice(11,15);
 if(!/^20\d{2}$/.test(year)||year<'2024'||year>today.slice(0,4))return {status:'outside_window',measures:null};
 if(items.some(i=>i.historyChecked!==true))return {status:'partial',measures:null};
 const details=items.map(i=>reconcileSiafiItem(i,{commitmentYear:year}));
 if(details.some(d=>d.status!=='reconciled'))return {status:'history_unreconciled',measures:null};
 const events=items.flatMap(i=>i.movements);
 if(events.some(m=>!validDay(m.date)||m.date<'2024-01-01'||m.date>today))
  return {status:'outside_window',measures:null};
 const initial=events.filter(m=>m.type==='original').reduce((n,m)=>n+BigInt(m.cents),0n);
 const issue_year_net=events.filter(m=>m.date.slice(0,4)===year).reduce((n,m)=>n+signed(m),0n);
 const net_before_cancellations=events.filter(m=>m.type!=='cancellation').reduce((n,m)=>n+signed(m),0n);
 const updated=events.reduce((n,m)=>n+signed(m),0n);
 const catalog=items.reduce((n,i)=>n+BigInt(i.cents),0n);
 const values={initial,issue_year_net,net_before_cancellations,updated};
 if(updated!==catalog||Object.values(values).some(v=>v<0n||v>BigInt(Number.MAX_SAFE_INTEGER)))
  return {status:'aggregate_invalid',measures:null};
 return {status:'comparable',measures:Object.fromEntries(MEASURES.map(k=>[k,Number(values[k])]))};
}
/** A assinatura retém TODAS as coincidências. Se duas medidas têm o mesmo
 * valor, a coincidência não permite distingui-las. */
export function classifyValueMeaning(cents,reconstruction){
 if(!validAmount(cents)||reconstruction?.status!=='comparable')return 'not_comparable';
 const matches=MEASURES.filter(k=>reconstruction.measures[k]===cents);
 return matches.length?matches.join('+'):'matches_none';
}
function classificationBucket(){
 return {total:0,eligible:0,discriminating:0,history:{},storedValue:{},
  byYear:{},changedWithinIssueYear:0,changedAfterIssueYear:0};
}
/** Coortes de divergentes e controles de catalogo coincidente; controles
 * selecionados pelo proprio criterio de igualdade, nao amostra representativa. */
export function summarizeStoredValueMeanings(months,{today}={}){
 const output={divergent:classificationBucket(),matchingCatalog:classificationBucket()};
 for(const r of indexCommitmentChronology(months).entries){
  if(r.owners.length!==1)continue;
  const {doc,items}=r.owners[0];
  const e=commitmentChronologyEvidence(doc,items,r.observations);
  if(e.reason!=='catalog_amount_mismatch'&&e.status!=='reconciled')continue;
  const bucket=e.reason==='catalog_amount_mismatch'?output.divergent:output.matchingCatalog;
  bucket.total++;
  const reconstructed=reconstructValueMeasures(r,items,{today});
  increment(bucket.history,reconstructed.status);
  const meaning=classifyValueMeaning(reference(r).cents,reconstructed);
  increment(bucket.storedValue,meaning);
  if(reconstructed.status!=='comparable')continue;
  bucket.eligible++;
  const m=reconstructed.measures,year=r.id.slice(11,15);
  const entry=bucket.byYear[year]||={eligible:0,discriminating:0,storedValue:{}};
  entry.eligible++;increment(entry.storedValue,meaning);
  if(new Set(Object.values(m)).size>1){bucket.discriminating++;entry.discriminating++}
  if(m.initial!==m.issue_year_net)bucket.changedWithinIssueYear++;
  if(m.issue_year_net!==m.updated)bucket.changedAfterIssueYear++;
 }
 return output;
}
/** Consulta novamente a listagem filtrada pela DATA DE REFERENCIA ja observada.
 * A data da consulta nao e prova de emissao. So aceita valor apos paginacao
 * completa e identidade/fase confirmadas de uma unica ocorrencia.
 * Resultado interno: valor nunca e impresso, nem persistido. */
export async function readFreshListingValue(record,{token,budget,now=new Date(),today,
 requestDay=requestDocuments,maxPages=3}={}){
 if(record?.owners?.length!==1||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>3||
    !validDay(today))throw Error('Consulta de listagem invalida');
 const ref=reference(record);
 if(!validDay(ref.date)||ref.date<'2024-01-01'||ref.date>today)return {status:'date_unverified',cents:null};
 const br=ref.date.split('-').reverse().join('/');
 const seen=new Set();let matched=0,cents=null,unverified=false;
 for(let page=1;page<=maxPages;page++){
  if(budget?.stopped())return {status:'budget_limited',cents:null};
  let rows;
  try{rows=await requestDay(br,1,page,{token,budget})}catch{return {status:'unavailable',cents:null}}
  if(!Array.isArray(rows)||rows.length>200||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))
   return {status:'invalid_page',cents:null};
  if(!rows.length){
   if(matched>1)return {status:'duplicate_identity',cents:null};
   if(unverified)return {status:'identity_unverified',cents:null};
   if(matched===0)return {status:'complete_no_match',cents:null};
   return validAmount(cents)?{status:'verified',cents}:{status:'amount_unavailable',cents:null};
  }
  const signature=JSON.stringify(rows.map(r=>[r.documento,r.codigoUg,r.fase,r.valor]));
  if(seen.has(signature))return {status:'repeated_page',cents:null};
  seen.add(signature);
  for(const row of rows.filter(r=>r.documento===record.id)){
   matched++;
   const identity=summarizeOriginalIssueFields(record.id,row,{now});
   if(!identity.identityConfirmed||!identity.phaseConfirmed){unverified=true;continue}
   cents=parseMoneyCents(row.valor);
  }
 }
 return {status:'pagination_incomplete',cents:null};
}
export function classifySourceAgreement(stored,detail,listing){
 if(!validAmount(stored)||detail.status!=='verified'||listing.status!=='verified'||
    !validAmount(detail.cents)||!validAmount(listing.cents))return 'not_comparable';
 if(stored===detail.cents&&stored===listing.cents)return 'all_equal';
 if(detail.cents===listing.cents)return 'current_sources_equal_stored_differs';
 if(stored===detail.cents)return 'detail_equals_stored_listing_differs';
 if(stored===listing.cents)return 'listing_equals_stored_detail_differs';
 return 'all_different';
}

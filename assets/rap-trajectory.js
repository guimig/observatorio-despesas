/** Trajetória exclusivamente documental CGU. Nunca produz saldo de RAP. */
import {validRelatedPair} from './trajectory.js';
const NE=/^158459\d{5}20\d{2}NE\d{6}$/;
const DOCUMENT=/^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/;
const year=id=>Number(id.slice(11,15));
const validNe=id=>typeof id==='string'&&NE.test(id)&&year(id)>=2024;
const validDocument=id=>typeof id==='string'&&DOCUMENT.test(id)&&year(id)>=2024;
const validDate=s=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export const RAP_IMPACT_KEYS=Object.freeze(['liquidatedCents','paidCents','rpInscribedCents','rpCancelledCents','rpPaidCents']);
const rapKeys=RAP_IMPACT_KEYS.slice(2);
const safeMoney=n=>Number.isSafeInteger(n)?n:null;
const fields=()=>Object.fromEntries(RAP_IMPACT_KEYS.map(k=>[k,null]));
const hasRap=c=>rapKeys.some(k=>Number.isSafeInteger(c?.[k])&&c[k]!==0);
const canonical=value=>typeof value==='string'?value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim():'';
export function qualifiedRapInscription(operation){
 return /^(inscricao (de|em) restos? a pagar|inscricao (de |em )?rp)$/.test(canonical(operation));
}
const append=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
function catalogEvidence(owner){
 const unavailable={status:'unavailable',totalItems:null,checkedItems:0,groups:[],observations:0,repeated:0};
 if(!owner||owner.doc.itemsDetailVersion!==2)return unavailable;
 const items=owner.month.itemsByDocument?.[owner.doc.id];
 if(!Array.isArray(items))return unavailable;
 if(new Set(items.map(i=>i.seq)).size!==items.length||items.some(i=>!Number.isSafeInteger(i.seq)||i.seq<1))
  return {...unavailable,status:'ambiguous'};
 const groups=new Map();let checkedItems=0,observations=0,repeated=0;
 for(const item of items){
  if(item.historyChecked!==true||!Array.isArray(item.movements))continue;
  checkedItems++;
  for(const e of item.movements){
   if(!qualifiedRapInscription(e?.operation))continue;
   // Identidade observacional, não chave de lançamento SIAFI. Não une itens
   // distintos nem converte multiplicidade em valor contabilizado.
   const sig=JSON.stringify([item.seq,e.date,e.operation,e.quantity,e.unitPrice,e.cents]);
   observations++;
   if(groups.has(sig)){groups.get(sig).occurrences++;repeated++;continue;}
   groups.set(sig,{seq:item.seq,date:validDate(e.date)?e.date:null,operation:e.operation,
    observedCents:safeMoney(e.cents),occurrences:1});
  }
 }
 const sorted=[...groups.values()].sort((a,b)=>(a.date||'').localeCompare(b.date||'')||a.seq-b.seq);
 return {status:!items.length?'empty_catalog':checkedItems===items.length?'checked_catalog':'partial_catalog',
  totalItems:items.length,checkedItems,groups:sorted,observations,repeated};
}
function impactEvidence(pair,owners){
 const sources=owners.get(pair.from)||[],owner=sources.length===1?sources[0]:null;
 const phase=owner?.doc.phase??(pair.from.slice(15,17)==='NS'?2:3);
 const date=validDate(owner?.doc.date)?owner.doc.date:null;
 const row={id:pair.from,phase,date,year:year(pair.from),month:owner?.month.month||null,
  interannual:year(pair.from)>year(pair.to),status:'unavailable',components:fields(),
  rowCount:null,repeatedRows:null,relatedOnly:pair.edges.length===0};
 if(sources.length>1||pair.edges.length>1||(owner&&![2,3].includes(owner.doc.phase))){
  row.status='ambiguous_identity';return row;
 }
 if(!owner||!pair.edges.length)return row;
 const {edge,month}=pair.edges[0];
 // Nunca atribuir valor por outra competência, por simples relatedIds ou
 // por endpoint ainda não verificado para a espécie do documento.
 if(month!==owner.month||!(phase===2?owner.doc.liquidationLinksChecked===true:owner.doc.paymentLinksChecked===true))
  return row;
 const c=edge.impactComponents;
 if(!c)return row;
 if(!Number.isSafeInteger(c.rowCount)||c.rowCount<1||!Number.isSafeInteger(c.repeatedRows)||
  c.repeatedRows<0||c.repeatedRows>=c.rowCount){row.status='ambiguous_impact';return row;}
 row.rowCount=c.rowCount;row.repeatedRows=c.repeatedRows;
 if(c.repeatedRows){row.status='ambiguous_impact';return row;}
 for(const k of RAP_IMPACT_KEYS)row.components[k]=safeMoney(c[k]);
 const {liquidatedCents,paidCents,rpPaidCents}=row.components;
 if((phase===2&&liquidatedCents!==null&&liquidatedCents!==edge.cents)||
    (phase===3&&paidCents!==null&&rpPaidCents!==null&&
     (!Number.isSafeInteger(paidCents+rpPaidCents)||paidCents+rpPaidCents!==edge.cents))){
  row.status='ambiguous_impact';row.components=fields();return row;
 }
 row.status=RAP_IMPACT_KEYS.every(k=>row.components[k]!==null)?'complete_fields':'partial_fields';
 return row;
}
/** Um mapa derivado por NE, sem duplicar o acervo. Escopo 2024+. Inclui
 * candidatos por inscrição, impacto RP explícito ou vínculo interanual.
 * A referência temporal isolada jamais é promovida a inscrição.
 * A ausência de evidência não prova inexistência nem completude contábil. */
export function buildRapTrajectories(months,{totalMonths=months.length}={}){
 const owners=new Map(),pairs=new Map(),candidates=new Set(),pairsByNe=new Map();
 for(const month of months){
  if(!month||month.unit!=='158459'||!Array.isArray(month.documents)||!Array.isArray(month.relations))
   throw Error('Competência incompatível com trajetória RAP');
  for(const doc of month.documents)if(validDocument(doc.id))append(owners,doc.id,{doc,month});
 }
 const pairFor=(from,to)=>{
  const key=from+'>'+to;
  if(!pairs.has(key)){const pair={from,to,edges:[]};pairs.set(key,pair);append(pairsByNe,to,pair);}
  return pairs.get(key);
 };
 for(const month of months){
  for(const edge of month.relations){
   if(!validNe(edge.to)||!validDocument(edge.from)||NE.test(edge.from))continue;
   const pair=pairFor(edge.from,edge.to);pair.edges.push({edge,month});
   if(year(edge.from)>year(edge.to)||hasRap(edge.impactComponents))candidates.add(edge.to);
  }
  for(const doc of month.documents)for(const other of doc.relatedIds||[]){
   if(!validRelatedPair(doc.id,other))continue;
   const to=NE.test(doc.id)?doc.id:other,from=NE.test(doc.id)?other:doc.id;
   if(year(from)<=year(to))continue;
   pairFor(from,to);candidates.add(to);
  }
  for(const [id,items] of Object.entries(month.itemsByDocument||{})){
   if(validNe(id)&&Array.isArray(items)&&items.some(i=>Array.isArray(i.movements)&&
    i.movements.some(e=>qualifiedRapInscription(e?.operation))))candidates.add(id);
  }
 }
 const entries=new Map(),loadedMonths=new Set(months.map(m=>m.month)).size;
 for(const id of candidates){
  const sources=owners.get(id)||[],owner=sources.length===1&&sources[0].doc.phase===1?sources[0]:null;
  const history=catalogEvidence(owner);
  if(sources.length>1)history.status='ambiguous';
  const relevant=(pairsByNe.get(id)||[]).filter(p=>year(p.from)>year(id)||p.edges.some(x=>hasRap(x.edge.impactComponents)));
  const impacts=relevant.map(p=>impactEvidence(p,owners)).sort((a,b)=>a.year-b.year||
   (a.date||'').localeCompare(b.date||'')||a.id.localeCompare(b.id));
  const counts={interannual:impacts.filter(x=>x.interannual).length,complete:impacts.filter(x=>x.status==='complete_fields').length,
   partial:impacts.filter(x=>x.status==='partial_fields').length,ambiguous:impacts.filter(x=>x.status.startsWith('ambiguous')).length,
   unavailable:impacts.filter(x=>x.status==='unavailable').length};
  entries.set(id,{id,originYear:year(id),originStatus:owner?'collected':sources.length?'ambiguous':'unavailable',
   history,impacts,counts,paymentEvidence:impacts.some(x=>x.phase===3&&Number.isSafeInteger(x.components.rpPaidCents)&&x.components.rpPaidCents!==0),
   explicitRapEvidence:history.observations>0||impacts.some(x=>hasRap(x.components)),
   pending:history.status!=='checked_catalog'||history.repeated>0||counts.partial+counts.ambiguous+counts.unavailable>0,
   loadedMonths,totalMonths,allMonthsLoaded:totalMonths>0&&loadedMonths===totalMonths,
   balanceCents:null,balanceStatus:'not_homologated'});
 }
 return entries;
}
export function matchesRapTrajectory(entry,{mode='all',originYear='all'}={}){
 if(mode==='all'&&originYear==='all')return true;
 if(!entry||originYear!=='all'&&String(entry.originYear)!==String(originYear))return false;
 return mode==='all'||mode==='candidate'||mode==='explicit'&&entry.explicitRapEvidence||
  mode==='inscription'&&entry.history.observations>0||mode==='repeated'&&entry.history.repeated>0||
  mode==='payment'&&entry.paymentEvidence||mode==='pending'&&entry.pending;
}

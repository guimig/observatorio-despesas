/** Grafo derivado em memoria, sem duplicar a base de documentos.
 * As arestas administrativas e financeiras nao tem a mesma semantica.
 * Nunca inferir pagamento de NS especifica, saldo de ata ou dotacao. */
import {buildCommitmentTrajectories} from './trajectory.js';
import {extractAraquariNeEvidence,matchDocumentContract} from './procurement-links.js';
import {commitmentChronologyEvidence} from './siafi-movement-reconciliation.js';
import {isFormalContract} from './instrument-types.js';
const NE=/^158459\d{5}20\d{2}NE\d{6}$/;
const PURCHASE=/^\d{14}-1-\d{6}\/20\d{2}$/;
const ATA=/^(\d{14}-1-\d{6}\/20\d{2})-(\d{6})$/;
const PROC=/^\d{5}\.\d{6}\/20\d{2}-\d{2}$/;
const inScope=id=>typeof id==='string'&&NE.test(id)&&Number(id.slice(11,15))>=2024;
const add=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
const unique=items=>[...new Set(items)];
const labelText=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function parseAtaControl(control){
 const m=typeof control==='string'&&ATA.exec(control);
 if(!m||Number(m[2])<1||Number(m[1].slice(-4))<2024)return null;
 return {procurementId:m[1],sequence:Number(m[2]),id:m[1]+':ata:'+Number(m[2])};
}
export function ataControlFor(ata){
 if(!PURCHASE.test(ata?.procurementId||'')||!Number.isSafeInteger(ata.sequence)||ata.sequence<1||
  ata.sequence>999999||Number(ata.procurementId.slice(-4))<2024||
  ata.id!==ata.procurementId+':ata:'+ata.sequence)return null;
 return ata.procurementId+'-'+String(ata.sequence).padStart(6,'0');
}
/** Identidade curta e contexto continuam candidatos: data CGU e listagem, nao emissao. */
export function contextualEvidenceMatches(doc,detail,observations=[]){
 return doc?.phase===1&&detail?.id===doc.id&&
  Number.isSafeInteger(detail.totalCents)&&detail.totalCents>0&&
  [doc.cents,...observations.filter(o=>o.id===doc.id).map(o=>o.cents)].includes(detail.totalCents);
}
function strongContext(doc,c,observations){
 return c.source==='pncp'&&c.commitmentStatus==='complete'&&doc?.phase===1&&
  /^\d{14}$/.test(c.supplierCnpj||'')&&c.supplierCnpj===doc.partyRef&&
  PROC.test(c.process||'')&&c.process===doc.process&&
  (c.commitmentContext||[]).some(row=>contextualEvidenceMatches(doc,row,observations));
}
const instrumentKey=c=>c.id||c.pncpId;
/** Correspondencias entre fontes sao candidatas, nunca identidade oficial.
 * A referencia CGU -> NE integral e uma aresta independente. */
export function indexCguContractEvidence(rows,contracts,{byNeDocument=new Map(),owners=new Map()}={}){
 const byNe=new Map(),byPncp=new Map(),byCgu=new Map(),records=new Map(),bySignature=new Map(),pncpRefs=new Map();
 const number=c=>{
  const m=/^(\d{1,6})(?:\/(20\d{2}))?$/.exec(String(c.number||''));
  return m&&Number(m[1])>0?{seq:Number(m[1]),year:m[2]||null}:null;
 };
 const signature=c=>{
  const n=number(c);
  return n&&/^20\d{2}-\d{2}-\d{2}$/.test(c.signed||'')&&['158459','158125'].includes(c.unitCode)?[n.seq,c.signed,c.unitCode].join('|'):null;
 };
 const conflict=(a,b)=>{
  const n=number(a),m=number(b);
  return Boolean(n&&m&&(n.seq!==m.seq||n.year&&m.year&&n.year!==m.year)||
   ['process','supplierCnpj','signed','unitCode'].some(k=>a[k]&&b[k]&&a[k]!==b[k]));
 };
 const formal=contracts.filter(c=>c.source==='pncp'&&isFormalContract(c)&&instrumentKey(c));
 for(const c of formal){
  if(signature(c))add(bySignature,signature(c),c);
  for(const ne of unique((c.commitmentRefs||[]).map(r=>extractAraquariNeEvidence(r)).filter(e=>e?.kind==='full'&&inScope(e.ne)).map(e=>e.ne)))add(pncpRefs,ne,c);
 }
 for(const row of rows||[]){
  if(!Number.isSafeInteger(row.id)||row.id<=0||!Array.isArray(row.refs)||!row.refs.length||!row.refs.every(inScope)||records.has(row.id))continue;
  records.set(row.id,row);
  for(const ne of unique(row.refs))add(byNe,ne,row);
 }
 const possible=new Map(),reverse=new Map();
 for(const row of records.values()){
  const found=new Map();
  for(const ne of unique(row.refs)){
   const matches=pncpRefs.get(ne)||[];
   if(byNe.get(ne)?.length!==1||matches.length!==1||conflict(row,matches[0]))continue;
   found.set(instrumentKey(matches[0]),{instrumentId:instrumentKey(matches[0]),basis:'shared_ne',reason:'NE integral declarada por ambas as fontes, sem concorrente ou conflito conhecido; identidade contratual ainda não confirmada.'});
  }
  const contexts=row.refs.filter(ne=>byNe.get(ne)?.length===1&&owners.get(ne)?.length===1)
   .map(ne=>byNeDocument.get(ne)).filter(Boolean);
  for(const c of bySignature.get(signature(row))||[]){
   if(conflict(row,c)||!PROC.test(c.process||'')||!/^\d{14}$/.test(c.supplierCnpj||''))continue;
   const id=instrumentKey(c);if(found.has(id))continue;
   const direct=row.process===c.process&&row.supplierCnpj===c.supplierCnpj;
   const contextual=contexts.some(d=>d.process===c.process&&d.partyRef===c.supplierCnpj)&&
    contexts.every(d=>(!PROC.test(d.process||'')||d.process===c.process)&&(!/^\d{14}$/.test(d.partyRef||'')||d.partyRef===c.supplierCnpj));
   if(direct||contextual)found.set(id,{instrumentId:id,basis:direct?'administrative_identity':'ne_context',reason:direct?
    'Número compatível, processo, CNPJ, assinatura e unidade coincidentes nas fontes; candidato, não confirmação.':
    'Número compatível, assinatura e unidade coincidentes; processo e CNPJ corroborados por NE integral CGU sem divergência observada. Candidato contextual, não confirmação.'});
  }
  possible.set(row.id,[...found.values()]);
  for(const id of found.keys())add(reverse,id,row.id);
 }
 for(const [id,matches] of possible){
  if(matches.length!==1||reverse.get(matches[0].instrumentId)?.length!==1)continue;
  const match=matches[0];byCgu.set(id,match);add(byPncp,match.instrumentId,records.get(id));
 }
 return {byNe,byPncp,byCgu,records};
}
export function buildIntegratedIndex({months=[],contracts=[],notices=[],atas=[],arpDetails=[],tender=null,cguContracts=[],totalMonths=months.length}={}){
 const entries=buildCommitmentTrajectories(months);
 const byNe=new Map(entries.map(e=>[e.id,e])),docs=new Map(),originsByDoc=new Map(),observations=new Map(),owners=new Map();
 for(const m of months){for(const o of m.commitmentObservations||[])add(observations,o.id,o);for(const d of m.documents)add(owners,d.id,m.month);}
 for(const m of months)for(const d of m.documents)docs.set(d.id,d);
 const cguEvidence=indexCguContractEvidence(cguContracts,contracts,{byNeDocument:docs,owners});
 for(const entry of entries)for(const link of entry.links){
  add(originsByDoc,link.id,{entry,link});
 }
 const byShort=new Map(),byProcess=new Map(),shortInstruments=new Map();
 for(const entry of entries){
  if(!entry.document||!inScope(entry.id))continue;
  add(byShort,entry.id.slice(-12),entry.document);
  if(PROC.test(entry.document.process||''))add(byProcess,entry.document.process,entry.document);
 }
 const instruments=new Map(contracts.filter(c=>instrumentKey(c)).map(c=>[instrumentKey(c),c]));
 for(const [id,c] of instruments)if(/^20\d{2}NE\d{6}$/.test(c.number||'')&&String(c.unitCode)==='158459')add(shortInstruments,c.number,id);
 const instrumentByPncp=new Map();
 for(const [id,c] of instruments)if(c.pncpId)add(instrumentByPncp,c.pncpId,id);
 const noticeMap=new Map(notices.map(n=>[n.pncpId,n]));
 const ataMap=new Map(atas.filter(a=>ataControlFor(a)).map(a=>[a.id,a]));
 const byAtaPurchase=new Map();
 for(const a of ataMap.values())add(byAtaPurchase,a.procurementId,a);
 const details=new Map(arpDetails.map(d=>[d.ataId,d]));
 const tenderByPurchase=new Map((tender?.procedures||[]).map(p=>[p.pncpId,p]));
 const byInstrument=new Map(),neEdges=new Map(),ataEdges=new Map(),noticeEdges=new Map();
 const ataEdgeKeys=new Set();
 function addAta(id,ataId,source){
  const key=id+'|'+ataId;
  if(ataEdgeKeys.has(key)){
   const old=ataEdges.get(id).find(x=>x.ataId===ataId);
   if(!old.sources.includes(source))old.sources.push(source);return;
  }
  ataEdgeKeys.add(key);
  const edge={instrumentId:id,ataId,ata:ataMap.get(ataId)||null,sources:[source]};
  add(ataEdges,id,edge);
 }
 for(const [id,c] of instruments){
  const a=parseAtaControl(c.ataControl);
  if(a)addAta(id,a.id,'controle_ata_instrumento');
 }
 // Consulta especifica da ata (direcao inversa), somente ID PNCP exato.
 for(const [ataId,d] of details){
  if(!ataMap.has(ataId))continue;
  for(const row of d.instruments||[])for(const id of instrumentByPncp.get(row.pncpId)||[])
   addAta(id,ataId,'consulta_instrumentos_da_ata');
 }
 const ataInstruments=new Map(),noticeInstruments=new Map();
 for(const [id,c] of instruments){
  const refs=new Set([...(c.commitmentRefs||[]),c.number].filter(Boolean));
  const candidate=new Map(),declared=new Set();
  for(const raw of refs){
   const ev=extractAraquariNeEvidence(raw);
   if(ev?.kind==='full'&&inScope(ev.ne)){
    declared.add(ev.ne);
    const d=byNe.get(ev.ne)?.document;if(d)candidate.set(d.id,d);
   }else if(ev?.kind==='ug_short'){
    for(const d of byShort.get(ev.short)||[])candidate.set(d.id,d);
   }else if(raw===c.number&&String(c.unitCode??'')==='158459'&&/^20\d{2}NE\d{6}$/.test(raw)){
    for(const d of byShort.get(raw)||[])candidate.set(d.id,d);
   }
  }
  for(const row of c.commitmentContext||[]){const d=byNe.get(row.id)?.document;if(d&&inScope(d.id))candidate.set(d.id,d);}
  if(PROC.test(c.process||''))for(const d of byProcess.get(c.process)||[])candidate.set(d.id,d);
  const edges=[];
  for(const [ne,doc] of candidate){
   const evidence=matchDocumentContract(doc,c);
   const obs=observations.get(ne)||[];
   const contextual=strongContext(doc,c,obs);
   if(!evidence&&!contextual)continue;
   const uniqueShort=String(c.unitCode)==='158459'&&c.number===ne.slice(-12)&&
    (byShort.get(c.number)||[]).length===1&&(shortInstruments.get(c.number)||[]).length===1&&
    owners.get(ne)?.length===1&&PROC.test(c.process||'')&&c.process===doc.process&&
    /^\d{14}$/.test(c.supplierCnpj||'')&&c.supplierCnpj===doc.partyRef&&
    Number.isSafeInteger(c.amountCents)&&c.amountCents>0&&[doc.cents,...obs.map(o=>o.cents)].includes(c.amountCents);
   const level=evidence?.level==='confirmed'?'confirmed':contextual?'contextual_candidate':uniqueShort?'high_confidence':evidence.level;
   const reason=level==='contextual_candidate'?'PNCP declara NE curta, CNPJ, processo e valor compatíveis; data de emissão PNCP independente da listagem CGU; identidade integral não declarada':
    level==='high_confidence'?'Unidade administrativa, NE curta, processo, CNPJ e valor coincidentes, sem concorrente no acervo carregado; não é confirmação SIAFI':evidence.reason;
   edges.push({instrumentId:id,ne,level,reason});
  }
  for(const ne of declared)if(!candidate.has(ne))edges.push({instrumentId:id,ne,level:'declared_ne',reason:'NE integral declarada; documento CGU não localizado no acervo carregado'});
  for(const edge of edges)add(neEdges,edge.ne,edge);
  byInstrument.set(id,edges);
  const byPurchase=new Map();
  if(PURCHASE.test(c.procurementId||''))byPurchase.set(c.procurementId,['controle_compra_instrumento']);
  for(const edge of ataEdges.get(id)||[]){
   add(ataInstruments,edge.ataId,edge);
   // A ata pode pertencer a outra licitacao (adesao). Nao confundir os IDs.
   const a=edge.ataId.split(':ata:')[0];
   if(!byPurchase.has(a))byPurchase.set(a,[]);
   if(!byPurchase.get(a).includes('origem_da_ata'))byPurchase.get(a).push('origem_da_ata');
  }
  for(const [purchase,sources] of byPurchase){
   const edge={instrumentId:id,purchaseId:purchase,notice:noticeMap.get(purchase)||null,sources};
   add(noticeEdges,id,edge);add(noticeInstruments,purchase,edge);
  }
 }
 return {entries,byNe,docs,originsByDoc,instruments,noticeMap,ataMap,byAtaPurchase,details,tenderByPurchase,cguEvidence,
  byInstrument,neEdges,ataEdges,noticeEdges,ataInstruments,noticeInstruments,observations,owners,
  loadedMonths:months.length,totalMonths,complete:totalMonths>0&&months.length===totalMonths};
}
export function neEvidenceLevel(index,id){
 const edges=index.neEdges.get(id)||[];
 if(edges.some(e=>e.level==='confirmed'))return 'confirmed';
 return edges.length?'indication':'none';
}
export function instrumentAssociations(index,kind,id){
 if(kind==='instrument')return index.instruments.has(id)?[{instrumentId:id,sources:['instrumento']}]:[];
 if(kind==='notice')return index.noticeInstruments.get(id)||[];
 if(kind==='ata')return index.ataInstruments.get(id)||[];
 return [];
}
function safeAdd(state,cents){
 if(!Number.isSafeInteger(cents)||!Number.isSafeInteger(state.cents+cents)){state.unknown++;return;}
 state.cents+=cents;state.known++;
}
/** Valores de NE documental e impactos CGU em grupos independentes.
 * NE com mais de um instrumento confirmado nao e alocada a nenhum.
 * Para ata, referencia conflitante/multipla tambem impede alocacao.
 * Ausencia de vinculo nunca representa zero executado. */
export function scopeFinancialEvidence(index,kind,id){
 const related=instrumentAssociations(index,kind,id);
 const byNe=new Map();
 for(const assoc of related)for(const e of index.byInstrument.get(assoc.instrumentId)||[])add(byNe,e.ne,e);
 const result={instruments:related.length,confirmed:[],declared:[],candidates:[],excluded:[],
  commitment:{known:0,unknown:0,cents:0},liquidation:{known:0,unknown:0,cents:0,documents:0},
  payment:{known:0,unknown:0,cents:0,documents:0}};
 const liqDocs=new Set(),payDocs=new Set();
 for(const [ne,edges] of byNe){
  const confirmed=edges.filter(e=>e.level==='confirmed');
  if(!confirmed.length){
   (edges.some(e=>e.level==='declared_ne')?result.declared:result.candidates).push({ne,edges});
   continue;
  }
  const row={ne,edges,entry:index.byNe.get(ne)};
  result.confirmed.push(row);
  const allConfirmed=unique((index.neEdges.get(ne)||[]).filter(e=>e.level==='confirmed').map(e=>e.instrumentId));
  if(allConfirmed.length!==1||!row.entry?.document||row.entry.issues?.length||index.owners.get(ne)?.length!==1||
     (kind==='ata'&&(index.ataEdges.get(allConfirmed[0])||[]).length!==1)){
   result.excluded.push(ne);continue;
  }
  const chronological=commitmentChronologyEvidence(row.entry.document,row.entry.items,index.observations.get(ne)||[]);
  safeAdd(result.commitment,chronological.status==='reconciled'?chronological.reportedCents:
    (index.observations.get(ne)||[]).length?null:row.entry.document.cents);
  for(const link of row.entry.liquidations){safeAdd(result.liquidation,link.cents);liqDocs.add(link.id);}
  for(const link of row.entry.payments){safeAdd(result.payment,link.cents);payDocs.add(link.id);}
 }
 result.liquidation.documents=liqDocs.size;result.payment.documents=payDocs.size;
 return result;
}
/** Subtotais documentais exclusivamente para as NEs declaradas pela CGU.
 * Nao misturar com PNCP, saldo contratual, valor do documento inteiro ou
 * inferir quitacao de NS. NE concorrente entre contratos CGU nao alocada. */
export function cguContractExecutionEvidence(index,id){
 const record=index.cguEvidence.records.get(id);
 const group=()=>({cents:0,known:0,unknown:0});
 const fields=['initialCents','reinforcementCents','annulmentCents','cancellationCents','reconstructedCents'];
 const movements=Object.fromEntries(fields.map(k=>[k,group()]));
 const result={references:unique(record?.refs||[]).length,located:0,eligible:0,reconciled:0,missing:[],ambiguous:[],conflicts:[],pendingChronology:[],rows:[],movements,
  liquidation:{...group(),documents:0,neWithoutKnown:0},payment:{...group(),documents:0,neWithoutKnown:0},periods:[]};
 const liqDocs=new Set(),payDocs=new Set(),periods=new Map();
 const period=(date,key,cents)=>{
  if(typeof date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(date)||date<'2024-01-01')return;
  const month=date.slice(0,7);
  if(!periods.has(month))periods.set(month,{month,...Object.fromEntries([...fields.slice(0,4),'liquidation','payment'].map(k=>[k,group()]))});
  safeAdd(periods.get(month)[key],cents);
 };
 for(const ne of unique(record?.refs||[])){
  const entry=index.byNe.get(ne);
  const row={ne,status:'pending',chronology:null,liquidation:group(),payment:group(),liquidationLinks:[],paymentLinks:[]};
  result.rows.push(row);
  if(entry?.document)result.located++;
  if(!entry?.document){row.status='missing';result.missing.push(ne);continue;}
  if(unique((index.cguEvidence.byNe.get(ne)||[]).map(c=>c.id)).length!==1){
   row.status='ambiguous';result.ambiguous.push(ne);continue;
  }
  if(entry.issues?.length||index.owners.get(ne)?.length!==1){
   row.status='conflict';result.conflicts.push(ne);continue;
  }
  result.eligible++;
  const chronology=commitmentChronologyEvidence(entry.document,entry.items,index.observations.get(ne)||[]);
  row.chronology=chronology;row.status=chronology.status;
  if(chronology.status==='reconciled'){
   result.reconciled++;
   for(const field of fields)safeAdd(movements[field],chronology[field]);
   for(const event of (entry.items||[]).flatMap(item=>item.movements||[])){
    const key={original:'initialCents',reinforcement:'reinforcementCents',annulment:'annulmentCents',cancellation:'cancellationCents'}[event.type];
    if(key)period(event.date,key,event.cents);
   }
  }else{
   result.pendingChronology.push(ne);
   for(const field of fields)safeAdd(movements[field],null);
  }
  for(const [key,links,docs] of [['liquidation',entry.liquidations,liqDocs],['payment',entry.payments,payDocs]]){
   for(const link of links){
    const known=link.document&&index.owners.get(link.id)?.length===1&&link.checked===true&&Number.isSafeInteger(link.cents);
    const cents=known?link.cents:null;
    row[key+'Links'].push({...link,cents});
    safeAdd(row[key],cents);safeAdd(result[key],cents);
    if(known){docs.add(link.id);period(link.date,key,cents);}
   }
   if(!row[key].known)result[key].neWithoutKnown++;
  }
 }
 result.liquidation.documents=liqDocs.size;result.payment.documents=payDocs.size;
 result.periods=[...periods.values()].sort((a,b)=>b.month.localeCompare(a.month));
 return result;
}
export function trajectoryMatches(index,entry,query){
 const q=labelText(query);if(!q)return true;
 const fields=[entry.id,entry.document?.process,entry.document?.partyRef,entry.document?.description,
  ...Object.values(entry.document?.nature||{}),...entry.links.map(l=>l.id),...(entry.items||[]).flatMap(i=>[i.purchaseItem,i.description])];
 for(const row of index.cguEvidence.byNe.get(entry.id)||[])fields.push(String(row.id),row.number,row.process,row.signed);
 for(const e of index.neEdges.get(entry.id)||[]){
  const c=index.instruments.get(e.instrumentId);
  fields.push(c?.number,c?.pncpId,c?.process,c?.object);
  for(const p of index.noticeEdges.get(e.instrumentId)||[])fields.push(p.purchaseId,p.notice?.number,p.notice?.object);
  for(const a of index.ataEdges.get(e.instrumentId)||[])fields.push(a.ataId,a.ata?.number,ataControlFor(a.ata),c?.ataControl);
 }
 return labelText(fields.filter(Boolean).join(' ')).includes(q);
}
/** Cruzamento de itens: sequencial extraido de descricao CGU e referencia
 * a catalogo exato; nao prova identidade do item, consumo ou saldo. */
export function itemReferenceCandidates(index,entry){
 const edges=index.neEdges.get(entry?.id)||[];
 const strict=unique(edges.filter(e=>e.level==='confirmed').map(e=>e.instrumentId));
 const candidates=unique(edges.filter(e=>['high_confidence','contextual_candidate'].includes(e.level)).map(e=>e.instrumentId));
 const selected=strict.length?strict:candidates;
 if(selected.length!==1||!entry?.document||entry.issues?.length||index.owners.get(entry.id)?.length!==1)return [];
 const id=selected[0],instrument=index.instruments.get(id),evidence=strict.length?'confirmed':'candidate';
 const aa=index.ataEdges.get(id)||[];
 if(aa.length>1)return [];
 const purchase=instrument.procurementId;
 if(!PURCHASE.test(purchase||''))return [];
 const tender=index.tenderByPurchase.get(purchase);
 const ata=aa[0]?.ata;
 // Se a ata e de outra compra (adesao), nao igualar numeros de item.
 const arp=ata?.procurementId===purchase?index.details.get(ata.id):null;
 const result=[];
 for(const item of entry.items||[]){
  const raw=String(item.purchaseItem??'');
  if(!/^\d{1,8}$/.test(raw)||Number(raw)<1)continue;
  const number=Number(raw);
  const ti=(tender?.items||[]).filter(i=>Number(i.number)===number);
  const ai=(arp?.compras?.items||[]).filter(i=>Number(i.number)===number&&
    i.supplierCnpj&&i.supplierCnpj===entry.document.partyRef&&i.supplierCnpj===instrument.supplierCnpj&&!i.excluded);
  const units=(arp?.unitItems||[]).filter(i=>Number(i.number)===number);
  if(ti.length!==1&&ai.length!==1)continue;
  result.push({seq:item.seq,number,purchaseId:purchase,instrumentId:id,ne:entry.id,item,evidence,
    tender:ti.length===1?ti[0]:null,ata:ai.length===1?ata:null,
    ataItem:ai.length===1?ai[0]:null,unitRecords:ai.length===1&&units.length===1?units[0].units:[]});
 }
 return result;
}
/** Direct reverse traversal of already-qualified NE item candidates; no duplicate database. */
export function scopeItemReferences(index,kind,id){
 const ids=unique(instrumentAssociations(index,kind,id).flatMap(a=>(index.byInstrument.get(a.instrumentId)||[])
  .filter(e=>['confirmed','high_confidence','contextual_candidate'].includes(e.level)).map(e=>e.ne)));
 return ids.flatMap(ne=>{
  const entry=index.byNe.get(ne);return entry?itemReferenceCandidates(index,entry):[];
 }).filter(r=>kind==='notice'?r.purchaseId===id:kind==='ata'?r.ata?.id===id:r.instrumentId===id);
}
/** Only ARP item rows confirmed by Compras.gov, joined to their exact procurement. */
export function noticeAtaItemReferences(index,purchase){
 const result=[];
 for(const ata of index.byAtaPurchase.get(purchase)||[]){
  for(const item of index.details.get(ata.id)?.compras?.items||[]){
   const tender=index.tenderByPurchase.get(purchase)?.items?.filter(t=>t.number===item.number)||[];
   result.push({ata,item,tender:tender.length===1?tender[0]:null});
  }
 }
 return result.sort((a,b)=>a.item.number-b.item.number||a.ata.sequence-b.ata.sequence);
}
export function ataFilesUrl(ata,seq=null){
 if(!ataControlFor(ata))return null;
 if(seq!==null&&(!Number.isSafeInteger(seq)||seq<1||seq>999999))return null;
 const m=/^(\d{14})-1-(\d{6})\/(20\d{2})$/.exec(ata.procurementId);
 return 'https://pncp.gov.br/api/pncp/v1/orgaos/'+m[1]+'/compras/'+m[3]+'/'+Number(m[2])+'/atas/'+ata.sequence+'/arquivos'+(seq===null?'':'/'+seq);
}
export function summarizeIntegratedCoverage(index){
 const instruments=[...index.instruments.values()],entries=index.entries.filter(e=>e.document&&inScope(e.id));
 const cguExecution=[...index.cguEvidence.records.keys()].map(id=>cguContractExecutionEvidence(index,id));
 const confirmed=entries.filter(e=>neEvidenceLevel(index,e.id)==='confirmed');
 const indications=entries.filter(e=>neEvidenceLevel(index,e.id)==='indication');
 const confirmedIds=new Set(confirmed.map(e=>e.id)),liquidations=new Set(),payments=new Set();
 const direct=entries.flatMap(e=>e.links.filter(l=>l.relatedCgu));
 const relatedOnly=direct.filter(l=>l.cents===null);
 const checked=[...index.docs.values()].filter(d=>Array.isArray(d.relatedIds));
 for(const e of confirmed){
  for(const l of e.liquidations)liquidations.add(l.id);
  for(const l of e.payments)payments.add(l.id);
 }
 const specific=instruments.filter(c=>index.ataEdges.has(instrumentKey(c)));
 const itemRefs=entries.flatMap(e=>itemReferenceCandidates(index,e));
 const high=entries.filter(e=>neEvidenceLevel(index,e.id)!=='confirmed'&&(index.neEdges.get(e.id)||[]).some(x=>x.level==='high_confidence'||x.level==='contextual_candidate'));
 const impact=new Set(index.entries.flatMap(e=>e.links.filter(l=>Number.isSafeInteger(l.cents)).map(l=>l.id)));
 const paymentsInIndex=[...index.docs.values()].filter(d=>d.phase===3);
 const liquidationsInIndex=[...index.docs.values()].filter(d=>d.phase===2);
 const arpRefs=[...index.byAtaPurchase.keys()].flatMap(p=>noticeAtaItemReferences(index,p));
 return {loadedMonths:index.loadedMonths,totalMonths:index.totalMonths,
  commitments:entries.length,confirmedCommitments:confirmed.length,indicatedCommitments:indications.length,
  highConfidenceCandidates:high.length, paymentDocuments:paymentsInIndex.length,paymentDocumentsWithImpact:paymentsInIndex.filter(d=>impact.has(d.id)).length,
  liquidationDocuments:liquidationsInIndex.length,liquidationDocumentsWithImpact:liquidationsInIndex.filter(d=>impact.has(d.id)).length,
  missingPurchases:new Set(instruments.filter(c=>PURCHASE.test(c.procurementId||'')&&!index.noticeMap.has(c.procurementId)).map(c=>c.procurementId)).size,
  missingReverseInstruments:new Set([...index.details.values()].flatMap(d=>(d.instruments||[]).map(i=>i.pncpId)).filter(id=>![...index.instruments.values()].some(c=>c.pncpId===id))).size,
  missingSpecificAtas:new Set([...index.ataEdges.values()].flat().filter(e=>!e.ata).map(e=>e.ataId)).size,
  candidateItemRefs:itemRefs.filter(r=>r.evidence==='candidate').length,
  relatedDocumentsChecked:checked.length,relatedNeChecked:checked.filter(d=>d.phase===1).length,
  cguRelatedPairs:direct.length,cguRelatedOnlyPairs:relatedOnly.length,
  cguRelatedOnlyDocuments:new Set(relatedOnly.map(l=>l.id)).size,
  relatedMissingNe:index.entries.filter(e=>!e.document&&inScope(e.id)&&e.links.some(l=>l.relatedCgu)).length,
  cguDirectContracts:index.cguEvidence.records.size,cguDirectNe:index.cguEvidence.byNe.size,
  cguDirectNePresent:[...index.cguEvidence.byNe.keys()].filter(ne=>index.byNe.get(ne)?.document).length,
  cguDirectPairs:[...index.cguEvidence.records.values()].reduce((n,c)=>n+c.refs.length,0),cguPncpCandidates:index.cguEvidence.byPncp.size,
  cguContractEligibleNe:cguExecution.reduce((n,c)=>n+c.eligible,0),cguContractReconciledNe:cguExecution.reduce((n,c)=>n+c.reconciled,0),
  cguContractAmbiguousNe:new Set(cguExecution.flatMap(c=>c.ambiguous)).size,
  cguContractKnownPaymentPairs:cguExecution.reduce((n,c)=>n+c.payment.known,0),cguContractUnknownPaymentPairs:cguExecution.reduce((n,c)=>n+c.payment.unknown,0),
  cguContractKnownLiquidationPairs:cguExecution.reduce((n,c)=>n+c.liquidation.known,0),cguContractUnknownLiquidationPairs:cguExecution.reduce((n,c)=>n+c.liquidation.unknown,0),
  cguCandidatesByBasis:Object.fromEntries(['shared_ne','administrative_identity','ne_context'].map(b=>[b,[...index.cguEvidence.byCgu.values()].filter(x=>x.basis===b).length])),
  ambiguousCommitments:confirmed.filter(e=>unique((index.neEdges.get(e.id)||[]).filter(x=>x.level==='confirmed').map(x=>x.instrumentId)).length>1).length,
  liquidationsWithConfirmedOrigin:liquidations.size,paymentsWithConfirmedOrigin:payments.size,
  neItemCandidates:itemRefs.length,neItemsWithAta:itemRefs.filter(r=>r.ataItem).length,
  commitmentsWithItemCandidates:new Set(itemRefs.map(r=>r.ne)).size,
  arpItemRowsWithTenderDescription:arpRefs.filter(r=>r.tender).length,
  instrumentsWithPurchase:instruments.filter(c=>PURCHASE.test(c.procurementId||'')).length,
  instrumentsWithLocalPurchase:instruments.filter(c=>index.noticeMap.has(c.procurementId)).length,
  instrumentsWithSpecificAta:specific.length,
  instrumentsWithLocalAta:specific.filter(c=>(index.ataEdges.get(instrumentKey(c))||[]).some(a=>a.ata)).length,
  instrumentsWithMultipleAtas:specific.filter(c=>(index.ataEdges.get(instrumentKey(c))||[]).length>1).length,
  instrumentsWithConfirmedNe:instruments.filter(c=>(index.byInstrument.get(instrumentKey(c))||[]).some(e=>confirmedIds.has(e.ne)&&e.level==='confirmed')).length};
}


/** Indice derivado, apenas identidades publicas e meses; nunca replica valores,
 * textos, favorecidos ou documentos. Mantem multiplos donos para auditoria. */
export function buildRelationshipLocator(months,{manifestWrite=null}={}){
 const owners=new Map(),neighbors=new Map();
 const addMonth=(map,id,month)=>{if(!map.has(id))map.set(id,new Set());map.get(id).add(month);};
 const valid=id=>typeof id==='string'&&/^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/.test(id);
 const pairs=[];
 for(const m of months){
  for(const d of m.documents||[])if(valid(d.id)){
   addMonth(owners,d.id,m.month);
   for(const other of d.relatedIds||[])if(valid(other))pairs.push([d.id,other,m.month]);
  }
  for(const r of m.relations||[])if(valid(r.from)&&valid(r.to))pairs.push([r.from,r.to,m.month]);
  for(const o of m.commitmentObservations||[])if(valid(o.id))addMonth(neighbors,o.id,m.month);
 }
 for(const [a,b,m] of pairs){
  addMonth(neighbors,a,m);addMonth(neighbors,b,m);
  for(const month of owners.get(a)||[])addMonth(neighbors,b,month);
  for(const month of owners.get(b)||[])addMonth(neighbors,a,month);
 }
 const encode=m=>Object.fromEntries([...m].sort(([a],[b])=>a.localeCompare(b)).map(([id,s])=>[id,[...s].sort()]));
 return {schema_version:1,unit:'158459',manifestWrite,months:months.map(m=>m.month).sort(),owners:encode(owners),neighbors:encode(neighbors)};
}

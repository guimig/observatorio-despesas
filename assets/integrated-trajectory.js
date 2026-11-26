/** Grafo derivado em memoria, sem duplicar a base de documentos.
 * As arestas administrativas e financeiras nao tem a mesma semantica.
 * Nunca inferir pagamento de NS especifica, saldo de ata ou dotacao. */
import {buildCommitmentTrajectories} from './trajectory.js';
import {extractAraquariNeEvidence,matchDocumentContract} from './procurement-links.js';
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
function strongContext(doc,c){
 return c.source==='pncp'&&c.commitmentStatus==='complete'&&doc?.phase===1&&
  /^\d{14}$/.test(c.supplierCnpj||'')&&c.supplierCnpj===doc.partyRef&&
  PROC.test(c.process||'')&&c.process===doc.process&&
  (c.commitmentContext||[]).some(row=>row.id===doc.id&&row.issueDate===doc.date&&row.totalCents===doc.cents);
}
const instrumentKey=c=>c.id||c.pncpId;
export function buildIntegratedIndex({months=[],contracts=[],notices=[],atas=[],arpDetails=[],tender=null,totalMonths=months.length}={}){
 const entries=buildCommitmentTrajectories(months);
 const byNe=new Map(entries.map(e=>[e.id,e])),docs=new Map(),originsByDoc=new Map();
 for(const m of months)for(const d of m.documents)docs.set(d.id,d);
 for(const entry of entries)for(const link of entry.links){
  add(originsByDoc,link.id,{entry,link});
 }
 const byShort=new Map(),byProcess=new Map();
 for(const entry of entries){
  if(!entry.document||!inScope(entry.id))continue;
  add(byShort,entry.id.slice(-12),entry.document);
  if(PROC.test(entry.document.process||''))add(byProcess,entry.document.process,entry.document);
 }
 const instruments=new Map(contracts.filter(c=>instrumentKey(c)).map(c=>[instrumentKey(c),c]));
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
  if(PROC.test(c.process||''))for(const d of byProcess.get(c.process)||[])candidate.set(d.id,d);
  const edges=[];
  for(const [ne,doc] of candidate){
   const evidence=matchDocumentContract(doc,c);
   const contextual=strongContext(doc,c);
   if(!evidence&&!contextual)continue;
   const level=evidence?.level==='confirmed'?'confirmed':contextual?'contextual_candidate':evidence.level;
   const reason=level==='contextual_candidate'?'NE abreviada, CNPJ, processo, data e valor coincidentes; identidade SIAFI integral não declarada':evidence.reason;
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
 return {entries,byNe,docs,originsByDoc,instruments,noticeMap,ataMap,byAtaPurchase,details,tenderByPurchase,
  byInstrument,neEdges,ataEdges,noticeEdges,ataInstruments,noticeInstruments,
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
  if(allConfirmed.length!==1||!row.entry?.document||row.entry.issues?.length||
     (kind==='ata'&&(index.ataEdges.get(allConfirmed[0])||[]).length!==1)){
   result.excluded.push(ne);continue;
  }
  safeAdd(result.commitment,row.entry.document.cents);
  for(const link of row.entry.liquidations){safeAdd(result.liquidation,link.cents);liqDocs.add(link.id);}
  for(const link of row.entry.payments){safeAdd(result.payment,link.cents);payDocs.add(link.id);}
 }
 result.liquidation.documents=liqDocs.size;result.payment.documents=payDocs.size;
 return result;
}
export function trajectoryMatches(index,entry,query){
 const q=labelText(query);if(!q)return true;
 const fields=[entry.id,entry.document?.process,entry.document?.partyRef,entry.document?.description,
  ...Object.values(entry.document?.nature||{}),...entry.links.map(l=>l.id)];
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
 const strict=unique((index.neEdges.get(entry.id)||[]).filter(e=>e.level==='confirmed').map(e=>e.instrumentId));
 if(strict.length!==1||!entry.document||entry.issues?.length)return [];
 const id=strict[0],instrument=index.instruments.get(id);
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
  result.push({seq:item.seq,number,purchaseId:purchase,item,
    tender:ti.length===1?ti[0]:null,ata:ai.length===1?ata:null,
    ataItem:ai.length===1?ai[0]:null,unitRecords:ai.length===1&&units.length===1?units[0].units:[]});
 }
 return result;
}
export function summarizeIntegratedCoverage(index){
 const instruments=[...index.instruments.values()],entries=index.entries.filter(e=>e.document&&inScope(e.id));
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
 return {loadedMonths:index.loadedMonths,totalMonths:index.totalMonths,
  commitments:entries.length,confirmedCommitments:confirmed.length,indicatedCommitments:indications.length,
  relatedDocumentsChecked:checked.length,relatedNeChecked:checked.filter(d=>d.phase===1).length,
  cguRelatedPairs:direct.length,cguRelatedOnlyPairs:relatedOnly.length,
  cguRelatedOnlyDocuments:new Set(relatedOnly.map(l=>l.id)).size,
  ambiguousCommitments:confirmed.filter(e=>unique((index.neEdges.get(e.id)||[]).filter(x=>x.level==='confirmed').map(x=>x.instrumentId)).length>1).length,
  liquidationsWithConfirmedOrigin:liquidations.size,paymentsWithConfirmedOrigin:payments.size,
  instrumentsWithPurchase:instruments.filter(c=>PURCHASE.test(c.procurementId||'')).length,
  instrumentsWithLocalPurchase:instruments.filter(c=>index.noticeMap.has(c.procurementId)).length,
  instrumentsWithSpecificAta:specific.length,
  instrumentsWithLocalAta:specific.filter(c=>(index.ataEdges.get(instrumentKey(c))||[]).some(a=>a.ata)).length,
  instrumentsWithMultipleAtas:specific.filter(c=>(index.ataEdges.get(instrumentKey(c))||[]).length>1).length,
  instrumentsWithConfirmedNe:instruments.filter(c=>(index.byInstrument.get(instrumentKey(c))||[]).some(e=>confirmedIds.has(e.ne)&&e.level==='confirmed')).length};
}

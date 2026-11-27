/** Reconstrucao aritmetica condicionada a evidencia completa da CGU.
 * Nao calcula empenho a liquidar, restos a pagar ou qualquer saldo contábil.
 */
import {inScopeRelatedDocument} from './trajectory.js';
const ACCEPTED=new Set(['original','reinforcement','annulment','cancellation']);
// Art. 36 da Lei 4.320/1964: inscricao em RP nao e novo empenho.
// Aceita somente a descricao exata observada, preservando tipo 'other'
// no JSON canonico. Nao presume que o valor inscrito seja saldo atual de RP.
export function isRpRegistration(event){
 return event?.type==='other'&&typeof event.operation==='string'&&
  event.operation.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase()==='INSCRICAO EM RP';
}
export const isMonetaryMovement=event=>ACCEPTED.has(event?.type);
export function signedCommitmentMovement(event){
 if(isRpRegistration(event))return 0n;
 if(!isMonetaryMovement(event)||!Number.isSafeInteger(event.cents)||event.cents<0)throw Error('Movimentacao monetaria invalida');
 return (event.type==='original'||event.type==='reinforcement'?1n:-1n)*BigInt(event.cents);
}
const integer=n=>Number.isSafeInteger(n);
const date=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
 new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const blank=(status,reason,checked=0,total=0)=>({
 status,reason,checked,total,initialCents:null,reinforcementCents:null,
 annulmentCents:null,cancellationCents:null,reconstructedCents:null,reportedCents:null,
 originalDate:null,lastMovementDate:null,originalDateMatchesListing:null,
 movements:0
});

/** Cada item deve ter historico integral, inclusao original unica e tipos inequívocos.
 * A sinalizacao e determinada PELO TIPO, nao pelo sinal de valorTotal da fonte.
 */
export function reconcileSiafiItem(item,{commitmentYear=null}={}){
 if(!item||item.historyChecked!==true)return blank('pending','history_unchecked',0,1);
 if(!Array.isArray(item.movements)||!item.movements.length)
   return blank('unavailable','no_movement_evidence',1,1);
 if(!integer(item.cents)||item.cents<0)
   return blank('unavailable','item_amount_invalid',1,1);
 // A fonte fornece dia, nao horario. A unica inclusao precede logicamente
 // outras operacoes daquele mesmo dia; nao se altera a ordem de outras datas
 // nem se presume ordem entre os demais eventos.
 const movements=[...item.movements].sort((a,b)=>String(a?.date).localeCompare(String(b?.date))||
  Number(b?.type==='original')-Number(a?.type==='original'));
 let initial=0,reinforcement=0,annulment=0,cancellation=0,balance=0,originalDate=null;
 for(const event of movements){
   if(!date(event?.date)||(!isMonetaryMovement(event)&&!isRpRegistration(event))||
      !integer(event.cents)||event.cents<0)
     return blank('unavailable','ambiguous_movement',1,1);
   if(isRpRegistration(event)){
     if(originalDate===null)return blank('unavailable','movement_before_original',1,1);
     // Caso observado: inscricao no exercicio imediatamente seguinte. Nao
     // inferir outra janela ou classificar outros rotulos como neutros.
     if(commitmentYear===null||!Number.isSafeInteger(Number(commitmentYear))||
        Number(event.date.slice(0,4))!==Number(commitmentYear)+1)
       return blank('unavailable','rp_registration_year_unverified',1,1);
     continue;
   }
   if(event.type==='original'){
     if(originalDate!==null)return blank('unavailable','multiple_originals',1,1);
     if(commitmentYear!==null&&Number(event.date.slice(0,4))!==Number(commitmentYear))
       return blank('unavailable','original_year_mismatch',1,1);
     originalDate=event.date;
     initial=event.cents;
     balance=event.cents;
   }else{
     if(originalDate===null)return blank('unavailable','movement_before_original',1,1);
     if(event.type==='reinforcement'){
       reinforcement+=event.cents;balance+=event.cents;
     }else if(event.type==='annulment'){
       annulment+=event.cents;balance-=event.cents;
     }else{
       // Manual SIAFI 021213: Cancelamento de item refere-se a restos a pagar.
       // Bloqueia sinal caso o ano da NE nao seja conhecido ou a data seja do exercicio.
       if(!Number.isSafeInteger(Number(commitmentYear))||commitmentYear===null||
          Number(event.date.slice(0,4))<=Number(commitmentYear))
         return blank('unavailable','cancellation_year_unverified',1,1);
       cancellation+=event.cents;balance-=event.cents;
     }
   }
   if(![initial,reinforcement,annulment,cancellation,balance].every(integer)||balance<0)
     return blank('unavailable','arithmetic_or_sequence_invalid',1,1);
 }
 if(originalDate===null)return blank('unavailable','original_missing',1,1);
 const result={status:balance===item.cents?'reconciled':'divergent',
   reason:balance===item.cents?'matched':'current_value_divergence',
   checked:1,total:1,initialCents:initial,reinforcementCents:reinforcement,
   annulmentCents:annulment,cancellationCents:cancellation,reconstructedCents:balance,reportedCents:item.cents,
   originalDate,lastMovementDate:movements.filter(isMonetaryMovement).at(-1).date,
   originalDateMatchesListing:null,movements:movements.filter(isMonetaryMovement).length};
 return result;
}

/** Resultado da NE exige TODOS os sequenciais, sem supor dados de itens ainda pendentes. */
export function reconcileSiafiCommitment(items,{listingDate=null,documentCents=null,commitmentYear=null}={}){
 if(!Array.isArray(items))return blank('unavailable','items_not_collected');
 if(!items.length)return blank('unavailable','empty_item_catalog');
 const checked=items.filter(i=>i.historyChecked===true).length;
 if(checked!==items.length)return blank('partial','histories_pending',checked,items.length);
 const details=items.map(item=>reconcileSiafiItem(item,{commitmentYear}));
 const failed=details.find(x=>x.status==='unavailable'||x.status==='pending');
 if(failed)return blank('unavailable',failed.reason,checked,items.length);
 const fields=['initialCents','reinforcementCents','annulmentCents','cancellationCents',
   'reconstructedCents','reportedCents'];
 const totals={};
 for(const field of fields){
   const value=details.reduce((sum,x)=>sum+x[field],0);
   if(!integer(value))return blank('unavailable','aggregate_overflow',checked,items.length);
   totals[field]=value;
 }
 const dates=details.map(x=>x.originalDate).sort();
 const first=dates[0],last=[...details.map(x=>x.lastMovementDate)].sort().at(-1);
 const comparable=integer(documentCents);
 const mismatch=details.some(x=>x.status==='divergent')||
   totals.reconstructedCents!==totals.reportedCents||
   (comparable&&totals.reportedCents!==documentCents);
 return {status:mismatch?'divergent':'reconciled',
   reason:mismatch?'current_value_divergence':'matched',
   checked,total:items.length,
   ...totals,originalDate:first,lastMovementDate:last,
   originalDateMatchesListing:date(listingDate)?first===listingDate:null,
   movements:details.reduce((sum,x)=>sum+x.movements,0),
   distinctOriginalDates:new Set(dates).size,
   matchesDocument:comparable?totals.reportedCents===documentCents:null
 };
}


/** A data da listagem e apenas uma referencia. Incluso original de item
 * nao equivale a data de emissao da NE. Movimentos conciliados sao
 * calculados pelo dia do evento, nunca pela diferenca entre snapshots. */
export function commitmentChronologyEvidence(doc,items,observations=[]){
 if(!doc||doc.phase!==1||!/^158459\d{5}20\d{2}NE\d{6}$/.test(doc.id))
  return {status:'unavailable',reason:'not_commitment',referenceDate:null,referenceCents:null};
 if(!inScopeRelatedDocument(doc.id))return {status:'unavailable',reason:'before_cutoff',referenceDate:doc.date,referenceCents:doc.cents,listingDates:[doc.date]};
 const refs=[{date:doc.date,cents:doc.cents},...observations.filter(o=>o.id===doc.id)];
 refs.sort((a,b)=>a.date.localeCompare(b.date));
 const reference=refs.at(-1);
 const base={referenceDate:reference.date,referenceCents:reference.cents,listingDates:[...new Set(refs.map(r=>r.date))]};
 if(!Number.isSafeInteger(reference.cents))return {...base,status:'pending',reason:'reference_amount_pending'};
 if(doc.itemsDetailVersion!==2||!Array.isArray(items))return {...base,status:'pending',reason:'items_not_collected'};
 if(!items.length)return {...base,status:'unavailable',reason:'empty_item_catalog'};
 if(items.some(item=>!integer(item.cents)||item.cents<0))return {...base,status:'unavailable',reason:'item_amount_invalid'};
 const catalogCents=items.reduce((sum,item)=>sum+BigInt(item.cents),0n);
 if(catalogCents!==BigInt(reference.cents))return {...base,status:'divergent',reason:'catalog_amount_mismatch'};
 if(observations.length&&Array.isArray(items)&&items.some(item=>!date(item.historyCheckedAt)||item.historyCheckedAt<reference.date))
   return {...base,status:'pending',reason:'history_older_than_listing'};
 const result=reconcileSiafiCommitment(items,{listingDate:doc.date,documentCents:reference.cents,commitmentYear:doc.id.slice(11,15)});
 return {...result,...base};
}
/** Indice efemero por identidade, compartilhado pelo planejador e pelo build. */
export function indexCommitmentChronology(months){
 const docs=new Map(),observations=new Map(),beforeCutoff=new Set();
 for(const month of months){
   for(const doc of month.documents||[]){
     if(doc.phase!==1||!/^158459\d{5}20\d{2}NE\d{6}$/.test(doc.id))continue;
     if(!inScopeRelatedDocument(doc.id)){beforeCutoff.add(doc.id);continue;}
     if(!docs.has(doc.id))docs.set(doc.id,[]);
     docs.get(doc.id).push({doc,month:month.month||doc.date.slice(0,7),items:month.itemsByDocument?.[doc.id]});
   }
   for(const o of month.commitmentObservations||[]){
     if(!observations.has(o.id))observations.set(o.id,[]);
     observations.get(o.id).push(o);
   }
 }
 return {entries:[...docs].map(([id,owners])=>({id,owners,observations:observations.get(id)||[]})),
   beforeCutoffIdentities:beforeCutoff.size,
   dateObservations:[...observations.entries()].filter(([id])=>docs.has(id)).reduce((n,[,x])=>n+x.length,0)};
}
export function buildCommitmentChronology(months,{today}={}){
 const {entries,dateObservations,beforeCutoffIdentities}=indexCommitmentChronology(months),periods={};
 const summary={identities:entries.length,reconciled:0,pending:0,duplicateIdentities:0,dateObservations,beforeCutoffIdentities,pendingReasons:{},byYear:[],periods};
 const years=new Map();
 for(const {id,owners,observations} of entries){
   const year=id.slice(11,15);
   if(!years.has(year))years.set(year,{year,identities:0,reconciled:0,pending:0});
   const y=years.get(year);y.identities++;
   const pending=reason=>{
     summary.pending++;y.pending++;
     summary.pendingReasons[reason]=(summary.pendingReasons[reason]||0)+1;
   };
   if(owners.length!==1){summary.duplicateIdentities++;pending('duplicate_identity');continue;}
   const {doc,items}=owners[0];
   const result=commitmentChronologyEvidence(doc,items,observations);
   if(result.status!=='reconciled'){pending(result.reason);continue;}
   // Uma data de inclusao futura, anterior ao recorte ou inconsistencias
   // aritmeticas tornam o conjunto inapto para totalizacao.
   const movements=items.flatMap(item=>item.movements||[]);
   if(movements.some(m=>m.date<'2024-01-01'||(today&&m.date>today))){pending('movement_outside_window');continue;}
   summary.reconciled++;y.reconciled++;
   const exercise=id.slice(11,15);
   for(const m of movements){
     if(!isMonetaryMovement(m)||(today&&m.date>=today))continue; // apenas eventos monetarios de dias encerrados
     const key=m.date.slice(0,7);
     const row=periods[key]||=( {initialCents:0,reinforcementCents:0,annulmentCents:0,priorYearReinforcementCents:0,priorYearAnnulmentCents:0,priorYearCancellationCents:0,movements:0,identities:0,_ids:new Set()} );
     const sameYear=m.date.slice(0,4)===exercise;
     const field=m.type==='original'?'initialCents':
       m.type==='reinforcement'?(sameYear?'reinforcementCents':'priorYearReinforcementCents'):
       m.type==='annulment'?(sameYear?'annulmentCents':'priorYearAnnulmentCents'):'priorYearCancellationCents';
     row[field]+=m.cents;row.movements++;row._ids.add(id);
   }
 }
 for(const row of Object.values(periods)){
   row.identities=row._ids.size;delete row._ids;
   row.netCents=row.initialCents+row.reinforcementCents-row.annulmentCents;
   row.priorYearNetCents=row.priorYearReinforcementCents-row.priorYearAnnulmentCents-row.priorYearCancellationCents;
   if(!Object.values(row).every(Number.isSafeInteger)){
     for(const key of Object.keys(row))if(key.endsWith('Cents'))row[key]=null;
   }
 }
 summary.byYear=[...years.values()].sort((a,b)=>a.year.localeCompare(b.year));
 return summary;
}

/** Medidas reconstruidas compartilhadas entre o navegador e o diagnostico CGU.
 * O valor documental e o valor dos itens sao evidencias independentes. */
export const MEASURES=Object.freeze(['initial','issue_year_net','net_before_cancellations','updated']);
const validAmount=x=>integer(x)&&x>=0;
const signed=signedCommitmentMovement;

/** Todos os itens precisam ser conhecidos, unicos e conciliados com o valorAtual.
 * As medidas sao reconstrucoes aritmeticas, nao saldos contabilisticos. */
export function reconstructValueMeasures(record,items,{today}={}){
 if(!record||record.owners?.length!==1||!date(today)||
    !Array.isArray(items)||!items.length)return {status:'unavailable',measures:null};
 if(items.some(i=>!Number.isSafeInteger(i.seq)||i.seq<1||!validAmount(i.cents))||
    new Set(items.map(i=>i.seq)).size!==items.length)return {status:'invalid_catalog',measures:null};
 const year=record.id.slice(11,15);
 if(!/^20\d{2}$/.test(year)||year<'2024'||year>today.slice(0,4))return {status:'outside_window',measures:null};
 if(items.some(i=>i.historyChecked!==true))return {status:'partial',measures:null};
 const details=items.map(i=>reconcileSiafiItem(i,{commitmentYear:year}));
 if(details.some(d=>d.status!=='reconciled'))return {status:'history_unreconciled',measures:null};
 const events=items.flatMap(i=>i.movements);
 if(events.some(m=>!date(m.date)||m.date<'2024-01-01'||m.date>today))
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

/** Visao derivada: nenhum campo novo nos JSONs mensais. Todos os valores
 * reconstruidos ficam nulos quando a evidencia interna nao e suficiente.
 * Nao altera commitmentChronologyEvidence nem os totais por competencia. */
export function commitmentValueEvidence(doc,items,observations=[],{today,uniqueIdentity=true}={}){
 const observed=observations.filter(o=>o.id===doc?.id);
 const chronology=commitmentChronologyEvidence(doc,items,observed);
 const out={documentCents:validAmount(doc?.cents)?doc.cents:null,
  referenceCents:validAmount(chronology.referenceCents)?chronology.referenceCents:null,
  referenceDate:chronology.referenceDate||null,catalogCents:null,
  initialCents:null,updatedCents:null,issueYearNetCents:null,netBeforeCancellationsCents:null,
  originalDate:null,lastMovementDate:null,itemsStatus:'unavailable',comparison:'not_comparable',
  chronologyStatus:chronology.status,chronologyReason:chronology.reason,meaning:'not_comparable'};
 if(!uniqueIdentity)return {...out,itemsStatus:'duplicate_identity'};
 if(!doc||doc.phase!==1||!inScopeRelatedDocument(doc.id)||!date(today)||
    !date(doc.date)||doc.date<'2024-01-01'||doc.date>today||
    !date(out.referenceDate)||out.referenceDate>today)return {...out,itemsStatus:'outside_window'};
 if(doc.itemsDetailVersion!==2||!Array.isArray(items))return {...out,itemsStatus:'items_not_collected'};
 if(!items.length)return {...out,itemsStatus:'empty_item_catalog'};
 if(items.some(i=>!integer(i.seq)||i.seq<1||!validAmount(i.cents))||
    new Set(items.map(i=>i.seq)).size!==items.length)return {...out,itemsStatus:'invalid_catalog'};
 const sum=items.reduce((n,i)=>n+BigInt(i.cents),0n);
 if(sum>BigInt(Number.MAX_SAFE_INTEGER))return {...out,itemsStatus:'aggregate_invalid'};
 out.catalogCents=Number(sum);
 // A consulta anterior a uma nova observacao documental nao prova atualidade.
 if(observed.length&&items.some(i=>!date(i.historyCheckedAt)||i.historyCheckedAt<out.referenceDate))
  return {...out,itemsStatus:'history_older_than_listing'};
 const r=reconstructValueMeasures({id:doc.id,owners:[{doc}],observations:observed},items,{today});
 if(r.status!=='comparable')return {...out,itemsStatus:r.status};
 const detail=reconcileSiafiCommitment(items,{commitmentYear:doc.id.slice(11,15)});
 return {...out,itemsStatus:'internally_reconciled',
  initialCents:r.measures.initial,updatedCents:r.measures.updated,
  issueYearNetCents:r.measures.issue_year_net,netBeforeCancellationsCents:r.measures.net_before_cancellations,
  originalDate:detail.originalDate,lastMovementDate:detail.lastMovementDate,
  comparison:out.referenceCents===null?'document_unavailable':out.referenceCents===r.measures.updated?'matching':'different',
  meaning:classifyValueMeaning(out.referenceCents,r)};
}
/** Cobertura exclusivamente por contagem, identidade unica e recorte vigente.
 * NEs com reconstrucoes independentes nao passam automaticamente ao fluxo. */
export function summarizeCommitmentValues(months,{today}={}){
 const {entries}=indexCommitmentChronology(months);
 const empty=()=>({identities:0,internal:0,documentMatching:0,documentDifferent:0,documentUnavailable:0,notReady:0});
 const result={...empty(),byYear:[],reasons:{}},years=new Map();
 for(const r of entries){
  const year=r.id.slice(11,15);
  if(!years.has(year))years.set(year,{year,...empty()});
  const y=years.get(year);
  result.identities++;y.identities++;
  const owner=r.owners[0],v=commitmentValueEvidence(owner.doc,owner.items,r.observations,{today,uniqueIdentity:r.owners.length===1});
  const key=v.itemsStatus==='internally_reconciled'?
   ({matching:'documentMatching',different:'documentDifferent',document_unavailable:'documentUnavailable'}[v.comparison]):'notReady';
  if(v.itemsStatus==='internally_reconciled'){result.internal++;y.internal++}
  result[key]++;y[key]++;
  if(key==='notReady')result.reasons[v.itemsStatus]=(result.reasons[v.itemsStatus]||0)+1;
 }
 result.byYear=[...years.values()].sort((a,b)=>a.year.localeCompare(b.year));
 return result;
}

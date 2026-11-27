/** Reconstrucao aritmetica condicionada a evidencia completa da CGU.
 * Nao calcula empenho a liquidar, restos a pagar ou qualquer saldo contábil.
 */
import {inScopeRelatedDocument} from './trajectory.js';
const ACCEPTED=new Set(['original','reinforcement','annulment','cancellation']);
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
 const movements=[...item.movements].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 let initial=0,reinforcement=0,annulment=0,cancellation=0,balance=0,originalDate=null;
 for(const event of movements){
   if(!date(event?.date)||!ACCEPTED.has(event?.type)||
      !integer(event.cents)||event.cents<0)
     return blank('unavailable','ambiguous_movement',1,1);
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
   originalDate,lastMovementDate:movements.at(-1).date,
   originalDateMatchesListing:null,movements:movements.length};
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
     if(today&&m.date>=today)continue; // apenas dias encerrados
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

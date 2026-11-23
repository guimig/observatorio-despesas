/** Reconstrucao aritmetica condicionada a evidencia completa da CGU.
 * Nao calcula empenho a liquidar, restos a pagar ou qualquer saldo contábil.
 */
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

/** Conferência de evidências documentais CGU, sem calcular saldo contábil. */
const TYPES=['original','reinforcement','annulment','cancellation','reversal','other','unknown'];
export function auditSiafiItemMovements(items,{issueDate=null,documentCents=null}={}){
  if(!Array.isArray(items))return {
    status:'unavailable',totalItems:null,checked:0,pending:null,
    counts:Object.fromEntries(TYPES.map(type=>[type,0])),
    currentItemsCents:null,documentAmountMatch:null,originalItemMismatches:0,
    emptyHistories:0
  };
  const counts=Object.fromEntries(TYPES.map(type=>[type,0]));
  let checked=0,emptyHistories=0,originalItemMismatches=0;
  let allAmountsKnown=true,currentItemsCents=0,additionalOperations=0;
  for(const item of items){
    if(!Number.isSafeInteger(item.cents))allAmountsKnown=false;
    else if(allAmountsKnown)currentItemsCents+=item.cents;
    if(item.historyChecked!==true)continue;
    checked++;
    const movements=Array.isArray(item.movements)?item.movements:[];
    if(!movements.length){emptyHistories++;continue;}
    for(const event of movements){
      const type=TYPES.includes(event.type)?event.type:'unknown';
      counts[type]++;
      if(type!=='original'||event.date!==issueDate)additionalOperations++;
    }
    if(movements.length!==1 || movements[0].type!=='original' ||
       movements[0].date!==issueDate ||
       !Number.isSafeInteger(item.cents) || movements[0].cents!==item.cents){
      originalItemMismatches++;
    }
  }
  if(!allAmountsKnown)currentItemsCents=null;
  const documentAmountMatch=currentItemsCents===null ||
    !Number.isSafeInteger(documentCents)?null:currentItemsCents===documentCents;
  const pending=items.length-checked;
  const status=pending>0?'partial':
    items.length===0?'no_items':
    emptyHistories>0?'no_movement_evidence':
    additionalOperations>0?'additional_operations':
    originalItemMismatches>0||documentAmountMatch===false?'requires_review':
    issueDate?'original_only_consistent':'requires_review';
  return {status,totalItems:items.length,checked,pending,counts,
    currentItemsCents,documentAmountMatch,originalItemMismatches,emptyHistories};
}

/** Evidência documental CGU: campos de impacto e inscrições, nunca saldo contábil. */
import {parseMoneyCents} from './cgu.mjs';
import {inscriptionLabelEvidence} from './rap-inscription-review.mjs';

export const IMPACT_FIELDS=Object.freeze({
 liquidatedCents:'valorLiquidado',paidCents:'valorPago',
 rpInscribedCents:'valorRestoInscrito',rpCancelledCents:'valorRestoCancelado',
 rpPaidCents:'valorRestoPago'
});
const moneyKeys=Object.keys(IMPACT_FIELDS);
const NE=/^158459\d{5}20\d{2}NE\d{6}$/;
const inScope=id=>NE.test(id)&&Number(id.slice(11,15))>=2024;
const has=(obj,key)=>Object.hasOwn(obj,key);
const amount=(row,key)=>parseMoneyCents(row?.[IMPACT_FIELDS[key]]);
const signature=(row)=>JSON.stringify([row?.subitem??null,...moneyKeys.map(k=>amount(row,k))]);

/** Cada par documento/NE preserva os campos separadamente. Campo omitido,
 * inválido, overflow ou linha indistinguível torna a respectiva evidência
 * indisponível. Não deduplicamos por valor: linhas iguais podem ser legítimas.
 * Os centavos legados do vínculo permanecem inalterados nesta etapa. */
export function aggregateImpactComponents(rows){
 const out={rowCount:rows.length,repeatedRows:0};
 const seen=new Set();
 for(const row of rows){
  const key=signature(row);
  if(seen.has(key))out.repeatedRows++;
  seen.add(key);
 }
 for(const k of moneyKeys){
  let sum=0,known=rows.length>0&&!out.repeatedRows;
  for(const row of rows){
   const n=amount(row,k);
   if(n===null||!Number.isSafeInteger(sum+n)){known=false;break;}
   sum+=n;
  }
  out[k]=known?sum:null;
 }
 return out;
}
export function validateImpactComponents(c,link,phase){
 if(!c||typeof c!=='object'||Array.isArray(c)||
    Object.keys(c).length!==moneyKeys.length+2||
    !['rowCount','repeatedRows',...moneyKeys].every(k=>has(c,k))||
    !Number.isSafeInteger(c.rowCount)||c.rowCount<1||
    !Number.isSafeInteger(c.repeatedRows)||c.repeatedRows<0||c.repeatedRows>=c.rowCount||
    moneyKeys.some(k=>c[k]!==null&&!Number.isSafeInteger(c[k]))||
    (c.repeatedRows>0&&moneyKeys.some(k=>c[k]!==null)))
  throw Error('Componentes documentais de impacto inválidos');
 if(phase===2&&c.liquidatedCents!==null&&c.liquidatedCents!==link.cents)
  throw Error('Componente de liquidação divergente do vínculo');
 if(phase===3&&c.paidCents!==null&&c.rpPaidCents!==null&&
    (!Number.isSafeInteger(c.paidCents+c.rpPaidCents)||c.paidCents+c.rpPaidCents!==link.cents))
  throw Error('Componentes de pagamento divergentes do vínculo');
 return c;
}

/** Classificação documental, sem mudar os tipos canônicos antigos. */
export function isRapInscription(event){
 return inscriptionLabelEvidence(event?.operation)==='qualified';
}
export function reviewRapItem(item){
 const events=Array.isArray(item?.movements)?item.movements:[];
 const candidates=events.filter(isRapInscription);
 const seen=new Set();
 let repeated=0;
 for(const event of candidates){
  const sig=JSON.stringify([event.date,event.operation,event.quantity,event.unitPrice,event.cents]);
  if(seen.has(sig))repeated++;
  seen.add(sig);
 }
 return {observations:candidates.length,repeated,indistinguishable:repeated>0};
}
export function needsRapComponentReview(link){
 return inScope(link?.to)&&typeof link?.from==='string'&&
  link.to.slice(11,15)<link.from.slice(11,15)&&
  (!link.impactComponents||moneyKeys.some(k=>link.impactComponents[k]===null));
}
/** Somente contagens; não soma valores nem infere inscrição/baixa pelo ano. */
export function summarizeRapEvidence(months){
 const report={notesWithInscription:0,itemsWithInscription:0,inscriptionObservations:0,
  repeatedInscriptionObservations:0,itemsWithRepeatedInscription:0,
  priorYearPairs:0,pairsWithComponents:0,priorYearPairsWithComponents:0,
  priorYearPairsPendingReview:0,priorYearPairsWithoutComponents:0,priorYearPairsPartialComponents:0,
  priorYearByOrigin:{},pairsWithRepeatedRows:0,positiveFields:Object.fromEntries(moneyKeys.map(k=>[k,0])),
  knownFields:Object.fromEntries(moneyKeys.map(k=>[k,0])),byYear:{}};
 const notes=new Set(),seenItems=new Set(),seenPairs=new Set();
 for(const m of months){
  for(const [id,items] of Object.entries(m.itemsByDocument||{})){
   if(!inScope(id))continue;
   for(const item of items){
    const key=id+'/'+item.seq;
    if(seenItems.has(key))continue;
    seenItems.add(key);
    const reviewed=reviewRapItem(item);
    if(!reviewed.observations)continue;
    notes.add(id);report.itemsWithInscription++;
    report.inscriptionObservations+=reviewed.observations;
    report.repeatedInscriptionObservations+=reviewed.repeated;
    if(reviewed.indistinguishable)report.itemsWithRepeatedInscription++;
    const y=report.byYear[id.slice(11,15)]||={inscriptionItems:0,inscriptionObservations:0,repeatedInscriptionObservations:0};
    y.inscriptionItems++;y.inscriptionObservations+=reviewed.observations;
    y.repeatedInscriptionObservations+=reviewed.repeated;
   }
  }
  for(const link of m.relations||[]){
   if(!inScope(link.to))continue;
   const key=link.from+'/'+link.to;if(seenPairs.has(key))continue;seenPairs.add(key);
   const prior=link.to.slice(11,15)<link.from.slice(11,15),c=link.impactComponents;
   if(prior){
    report.priorYearPairs++;
    const y=report.priorYearByOrigin[link.to.slice(11,15)]||={pairs:0,withoutComponents:0,partialComponents:0,completeComponents:0};
    y.pairs++;
    if(!c){report.priorYearPairsWithoutComponents++;y.withoutComponents++;}
    else if(needsRapComponentReview(link)){report.priorYearPairsPartialComponents++;y.partialComponents++;}
    else y.completeComponents++;
   }
   if(needsRapComponentReview(link))report.priorYearPairsPendingReview++;
   if(!c)continue;
   report.pairsWithComponents++;if(prior)report.priorYearPairsWithComponents++;
   if(c.repeatedRows)report.pairsWithRepeatedRows++;
   for(const k of moneyKeys){
    if(Number.isSafeInteger(c[k]))report.knownFields[k]++;
    if(Number.isSafeInteger(c[k])&&c[k]>0)report.positiveFields[k]++;
   }
  }
 }
 report.notesWithInscription=notes.size;
 return report;
}

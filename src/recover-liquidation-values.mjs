/** Recupera somente valores ausentes de liquidacoes com listagem paginada concluida.
 * A soma e proveniente de impactos oficiais integralmente identificados.
 * Nao reconsulta a listagem, nao sobrescreve valor conhecido e nao inventa zero.
 */
import {resolveLiquidation} from './cgu.mjs';
import {inScopeDate} from './collection-scope.mjs';
import {applyDocumentEnrichment} from './store.mjs';
export const MAX_VALUES_PER_DATE=24;
export function canResumeLiquidations(month,date){
 const c=month?.coverage?.find(c=>c.date===date&&c.phase===2);
 if(!c?.complete||!c.invalid)return false;
 return c.invalid===month.documents.filter(d=>d.date===date&&d.phase===2&&d.cents===null).length;
}
export async function recoverLiquidationValues(month,date,{
 token,budget,limit=MAX_VALUES_PER_DATE,slot=0,resolve=resolveLiquidation,persist=async()=>{},now=new Date()
}={}){
 if(!inScopeDate(date)||!Number.isSafeInteger(limit)||limit<1||limit>MAX_VALUES_PER_DATE||
   !Number.isSafeInteger(slot)||slot<0)throw Error('Plano de recuperacao de valores invalido');
 const summary={eligible:0,attempted:0,recovered:0,unresolved:0,deferred:0};
 if(!canResumeLiquidations(month,date))return {data:month,summary};
 const candidates=month.documents.filter(d=>d.date===date&&d.phase===2&&d.cents===null)
  .sort((a,b)=>a.id.localeCompare(b.id));
 summary.eligible=candidates.length;
 const offset=slot%candidates.length;
 const selected=candidates.slice(offset).concat(candidates.slice(0,offset)).slice(0,limit);
 let data=month;
 for(const doc of selected){
  if(budget?.stopped())break;
  summary.attempted++;
  const value=await resolve(doc.id,{token,budget});
  if(value.cents===null||!Number.isSafeInteger(value.cents)||!value.links?.length||value.unlinked){
   if(!budget?.stopped())summary.unresolved++;
   continue;
  }
  const result={kind:'liquidationValue',cents:value.cents,links:value.links};
  const outcome=applyDocumentEnrichment(data,doc.id,result,now);
  if(outcome.changed){
   await persist(doc.id,result);data=outcome.data;summary.recovered++;
  }
 }
 summary.deferred=summary.eligible-summary.recovered-summary.unresolved;
 return {data,summary};
}

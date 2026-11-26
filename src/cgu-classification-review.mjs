/** Reconsulta restrita de classificacao: nunca altera cobertura, valor, data,
 * relacoes, favorecido, itens ou a identidade do documento. */
import {inScopeDate,inScopeMonth} from './collection-scope.mjs';
import {currentDateInBrazil} from './backfill.mjs';
import {validateMonth} from './store.mjs';
const TARGET=['function','subfunction','economicCategory','applicationMode','locator','subtitle','budgetPlan'];
const DAY=86400000;
export function needsClassification(doc){
 return TARGET.some(key=>!doc.nature?.[key]);
}
export function planClassificationReview(months,{now=new Date(),batch=6,exclude=[]}={}){
 if(!Array.isArray(months)||!Number.isSafeInteger(batch)||batch<0||batch>12)throw Error('Lote classificacao invalido');
 if(!batch)return [];
 const today=currentDateInBrazil(now),excluded=new Set(exclude),keys=new Set();
 for(const month of months){
  if(!inScopeMonth(month.month))continue;
  for(const doc of month.documents||[]){
   const key=doc.date+'/'+doc.phase;
   if(!inScopeDate(doc.date)||doc.date>=today||![1,2,3].includes(doc.phase)||excluded.has(key)||!needsClassification(doc))continue;
   if(doc.natureCheckedAt&&now.getTime()-Date.parse(doc.natureCheckedAt+'T00:00:00Z')<90*DAY)continue;
   keys.add(key);
  }
 }
 const all=[...keys].sort(),offset=all.length?(Math.floor(now.getTime()/(12*3600000))*batch)%all.length:0;
 return all.slice(offset).concat(all.slice(0,offset)).slice(0,batch).map(key=>{
  const [date,phase]=key.split('/');return {date,phase:Number(phase)};
 });
}
export function mergeObservedNature(previous,incoming){
 const old={...(previous||{})};
 if(['action','program','function','subfunction'].some(k=>incoming?.[k]!==undefined&&incoming[k]!==old[k])){
  for(const k of ['budgetPlan','locator','subtitle'])delete old[k];
 }
 return {...old,...incoming};
}
export function applyClassificationPatch(month,patch,{now=new Date()}={}){
 validateMonth(month);
 const c=patch?.coverage;
 if(!c||c.complete!==true||!inScopeDate(c.date)||!c.date.startsWith(month.month)||
  c.date>=currentDateInBrazil(now)||![1,2,3].includes(c.phase)||
  !Array.isArray(patch.documents)||patch.documents.length!==c.count)
  throw Error('Reconsulta classificacao incompleta ou fora do escopo');
 const incoming=new Map();
 for(const row of patch.documents){
  if(row.date!==c.date||row.phase!==c.phase||typeof row.id!=='string'||incoming.has(row.id))
   throw Error('Identidade da listagem divergente');
  incoming.set(row.id,row);
 }
 const next=structuredClone(month);let matched=0,updated=0,skipped=0;
 const today=currentDateInBrazil(now);
 for(const doc of next.documents){
  if(doc.date!==c.date||doc.phase!==c.phase)continue;
  const row=incoming.get(doc.id);
  if(!row||(Number.isSafeInteger(row.cents)&&Number.isSafeInteger(doc.cents)&&row.cents!==doc.cents)){skipped++;continue;}
  matched++;
  const before=JSON.stringify(doc.nature||{});
  const merged=mergeObservedNature(doc.nature,row.nature);
  if(Object.keys(merged).length)doc.nature=merged;
  if(needsClassification(doc))doc.natureCheckedAt=today;
  else delete doc.natureCheckedAt;
  if(before!==JSON.stringify(doc.nature||{}))updated++;
 }
 validateMonth(next);
 if(JSON.stringify(next)===JSON.stringify(month))return {changed:false,data:month,matched,updated,skipped};
 next.updated_at=now.toISOString();
 return {changed:true,data:next,matched,updated,skipped};
}

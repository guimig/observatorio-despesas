/** Distribui capacidade entre meses sem repetir dias completos nem criar fila persistente. */
import {scopeMonths,assertScopeMonth,FIRST_MONTH} from './collection-scope.mjs';
import {planHistoricalDays} from './backfill.mjs';
import {BACKFILL_LIMITS} from './cgu-budget.mjs';
export async function planAdaptiveBackfill({now=new Date(),earliestMonth=FIRST_MONTH,
 loadExisting=async()=>null,priorityYears=[],prioritize=false,slot=Math.floor(now.getTime()/43200000),
 maxDays=BACKFILL_LIMITS.days}={}){
 assertScopeMonth(earliestMonth);
 if(!Number.isSafeInteger(slot)||slot<0||!Number.isSafeInteger(maxDays)||maxDays<1||maxDays>BACKFILL_LIMITS.days)
  throw Error('Plano adaptativo invalido');
 const months=scopeMonths(now).filter(m=>m>=earliestMonth);
 const offset=slot%Math.max(1,months.length),ordered=months.slice(offset).concat(months.slice(0,offset));
 const candidates=[];
 for(const month of ordered){
  const existing=await loadExisting(month);
  const dates=planHistoricalDays({month,existing,now,batchDays:7,dayOffset:slot});
  if(dates.length)candidates.push({month,dates,priority:priorityYears.includes(month.slice(0,4))});
 }
 // Primeira volta distribui dias por competencias; a segunda e seguintes
 // reaproveitam capacidade. Reserva metade para origens referenciadas, se houver.
 const primary=candidates.filter(x=>prioritize&&x.priority),ordinary=candidates.filter(x=>!prioritize||!x.priority);
 const makeQueue=groups=>Array.from({length:7},(_,i)=>groups.flatMap(x=>x.dates[i]?[{month:x.month,date:x.dates[i]}]:[])).flat();
 const a=makeQueue(primary),b=makeQueue(ordinary),tasks=[];
 while(tasks.length<maxDays&&(a.length||b.length)){
  const next=(tasks.length%2===0?a.shift()||b.shift():b.shift()||a.shift());
  tasks.push(next);
 }
 return {tasks,eligibleMonths:candidates.length};
}

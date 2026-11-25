/** Distribui capacidade entre meses sem repetir dias completos nem criar fila persistente. */
import {scopeMonths,assertScopeMonth,FIRST_MONTH} from './collection-scope.mjs';
import {planHistoricalDays,currentDateInBrazil} from './backfill.mjs';
import {BACKFILL_LIMITS,INTENSIVE_LIMITS} from './cgu-budget.mjs';
export async function planAdaptiveBackfill({now=new Date(),earliestMonth=FIRST_MONTH,
 loadExisting=async()=>null,priorityYears=[],prioritize=false,slot=Math.floor(now.getTime()/14400000),
 maxDays=BACKFILL_LIMITS.days,priorityDates=[]}={}){
 assertScopeMonth(earliestMonth);
 if(!Number.isSafeInteger(slot)||slot<0||!Number.isSafeInteger(maxDays)||maxDays<1||maxDays>INTENSIVE_LIMITS.days)
  throw Error('Plano adaptativo invalido');
 const months=scopeMonths(now).filter(m=>m>=earliestMonth);
 const offset=slot%Math.max(1,months.length),ordered=months.slice(offset).concat(months.slice(0,offset));
 const candidates=[],targeted=[];
 const today=currentDateInBrazil(now);
 for(const date of [...new Set(priorityDates)]){
  const month=date.slice(0,7),day=Number(date.slice(8,10));
  if(!months.includes(month)||!/^20\d{2}-\d{2}-\d{2}$/.test(date)||date>=today||day<1||day>31)continue;
  const existing=await loadExisting(month);
  const candidate=date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);
  if(planHistoricalDays({month,existing,now,batchDays:1,startDay:day}).includes(candidate))targeted.push({month,date:candidate});
 }
 for(const month of ordered){
  const existing=await loadExisting(month);
  const dates=planHistoricalDays({month,existing,now,batchDays:7,dayOffset:slot});
  if(dates.length)candidates.push({month,dates,priority:priorityYears.includes(month.slice(0,4))});
 }
 // Primeira volta distribui dias por competencias; a segunda e seguintes
 // reaproveitam capacidade. Reserva metade para origens referenciadas, se houver.
 const primary=candidates.filter(x=>prioritize&&x.priority),ordinary=candidates.filter(x=>!prioritize||!x.priority);
 const makeQueue=groups=>Array.from({length:7},(_,i)=>groups.flatMap(x=>x.dates[i]?[{month:x.month,date:x.dates[i]}]:[])).flat();
 const tasks=targeted.slice(0,maxDays),seen=new Set(tasks.map(t=>t.date));
 const a=makeQueue(primary).filter(t=>!seen.has(t.date)),b=makeQueue(ordinary).filter(t=>!seen.has(t.date));
 while(tasks.length<maxDays&&(a.length||b.length)){
  const next=(tasks.length%2===0?a.shift()||b.shift():b.shift()||a.shift());
  tasks.push(next);
 }
 return {tasks,eligibleMonths:candidates.length};
}

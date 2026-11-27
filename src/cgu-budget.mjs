/** Limites internos conservadores, nao a quota contratual da CGU. Uma chamada
 * sequencial a cada 1,5s, contando inclusive paginacao e tentativas HTTP. */
export const BACKFILL_LIMITS=Object.freeze({requests:120,durationMs:8*60*1000,spacingMs:1500,days:21});
// A capacidade ampliada continua sequencial, sem reduzir o intervalo entre chamadas.
export const INTENSIVE_LIMITS=Object.freeze({...BACKFILL_LIMITS,requests:240,days:42});
export const HISTORICAL_INTENSIVE_LIMITS=Object.freeze({
 ...INTENSIVE_LIMITS,requests:360,durationMs:11*60*1000,days:63
});
export function collectionLimits({intensive=false,backlog=0,threshold=21}={}){
 if(!Number.isSafeInteger(backlog)||backlog<0||!Number.isSafeInteger(threshold)||threshold<1)
  throw Error('Passivo operacional invalido');
 return intensive&&backlog>threshold?INTENSIVE_LIMITS:BACKFILL_LIMITS;
}
export function createCguBudget({requests=BACKFILL_LIMITS.requests,durationMs=BACKFILL_LIMITS.durationMs,
 spacingMs=BACKFILL_LIMITS.spacingMs,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!Number.isSafeInteger(requests)||requests<1||requests>HISTORICAL_INTENSIVE_LIMITS.requests||!Number.isSafeInteger(durationMs)||durationMs<1||durationMs>HISTORICAL_INTENSIVE_LIMITS.durationMs||
    !Number.isSafeInteger(spacingMs)||spacingMs<0)throw Error('Limite operacional invalido');
 const start=clock();let count=0,last=null,stop=null,consecutive=0;
 const responses={};
 function stopped(){
  if(!stop&&count>=requests)stop='request_budget';
  if(!stop&&clock()-start>=durationMs)stop='time_budget';
  return stop;
 }
 function error(){return Object.assign(Error('Limite operacional CGU'),{code:'CGU_BUDGET_STOP'});}
 function observe(status){
  const key=Number.isInteger(status)?String(status):'transport';
  responses[key]=(responses[key]||0)+1;
  if([401,403,429].includes(status))stop='http_'+status;
  if(status===null||status>=500){if(++consecutive>=3&&!stop)stop='source_unstable'}
  else consecutive=0;
 }
 return {stopped,observe,
  async beforeRequest(){
   if(stopped())throw error();
   const delay=last===null?0:Math.max(0,spacingMs-(clock()-last));
   if(delay){await sleep(delay);if(stopped())throw error()}
   last=clock();count++;
  },
  snapshot(){return {requests:count,responses:{...responses},elapsedMs:Math.max(0,clock()-start),stopReason:stopped()}}
 };
}

/** Indicador operacional, nao autorizacao para aumentar frequencia. Exige
 * estabilidade em varias rodadas e avaliacao da quota global antes de alterar agenda. */
export function assessCollectionCapacity({attempted,successes,changed,limits,snapshot}){
 const {requests,responses,elapsedMs,stopReason}=snapshot;
 const ratio=(n,d)=>d?Math.round(1000*n/d)/10:null;
 const bad=Object.entries(responses).reduce((n,[k,v])=>n+(k==='transport'||Number(k)>=500?v:0),0);
 const restricted=['401','403','429'].some(k=>responses[k]>0);
 const requestUse=ratio(requests,limits.requests),timeUse=ratio(elapsedMs,limits.durationMs);
 const successRate=ratio(successes,attempted),changeRate=ratio(changed,attempted);
 const status=restricted?'restricted':bad||stopReason==='source_unstable'?'unstable':stopReason?'limit_reached':
  !attempted||successRate<90?'insufficient_or_failed':changed===0?'no_new_evidence':
  requestUse<=75&&timeUse<=75?'headroom_observed':'near_limit';
 return {status,requestUse,timeUse,successRate,changeRate,frequencyIncreaseAuthorized:false};
}

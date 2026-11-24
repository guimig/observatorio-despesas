import {FIRST_MONTH} from './collection-scope.mjs';
import {planAdaptiveBackfill} from './backfill-adaptive.mjs';
import {createCguBudget,BACKFILL_LIMITS} from './cgu-budget.mjs';
/** Recuperação CGU por pequenos lotes, com checkpoints no próprio JSON mensal. */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { collectDayPhase,isoDate } from './cgu.mjs';
import {canResumeLiquidations,recoverLiquidationValues} from './recover-liquidation-values.mjs';
import { collectHistoricalDate,documentCollisionSummary,collisionCode,phasesMissingOnDate } from './historical-collector.mjs';
import { planHistoricalDays, chooseHistoricalMonth, missingCommitmentYears } from './backfill.mjs';
import { persistWindow, persistEnrichment, validateMonth, validatePublishedData } from './store.mjs';

async function readExisting(month) {
  const path = join(process.cwd(), 'data', 'months', month + '.json');
  try { return validateMonth(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function referencedYears() {
  const folder=join(process.cwd(),'data','months');
  const names=(await readdir(folder)).filter(name=>/^20\d{2}-(0[1-9]|1[0-2])\.json$/.test(name));
  const months=[];
  for(const name of names) months.push(await readExisting(name.slice(0,7)));
  return missingCommitmentYears(months.filter(Boolean));
}
async function main() {
  const now = new Date();
  const priorityYears=await referencedYears();
  const preference=process.env.BACKFILL_PRIORITY_REFERENCES || 'auto';
  if(!['auto','true','false'].includes(preference)) throw Error('Preferência de prioridade inválida');
  const prioritize=preference==='true'||(preference==='auto' &&
    Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',day:'numeric'}).format(now))%2===1);
  const adaptive=process.env.BACKFILL_ADAPTIVE==='true'&&!process.env.BACKFILL_MONTH&&process.env.BACKFILL_RECHECK!=='true';
  const adaptivePlan=adaptive?await planAdaptiveBackfill({now,earliestMonth:process.env.BACKFILL_EARLIEST_MONTH||FIRST_MONTH,loadExisting:readExisting,priorityYears,prioritize,priorityDates:(process.env.BACKFILL_PRIORITY_DATES||'').split(',').filter(Boolean)}):null;
  const month = adaptive?adaptivePlan.tasks[0]?.month:await chooseHistoricalMonth({
    requestedMonth:process.env.BACKFILL_MONTH||'',
    earliestMonth:process.env.BACKFILL_EARLIEST_MONTH||FIRST_MONTH,
    includeCurrent:true,
    rotationSlot:process.env.BACKFILL_ROTATE==='true'?Math.floor(now.getTime()/43200000):null,
    now,loadExisting:readExisting,priorityYears,prioritize
  });
  if (!month) {
    console.log('Nenhuma competência histórica com dias pendentes no intervalo configurado.');
    return;
  }
  const batchDays=Number(process.env.BACKFILL_DAYS || 3);
  const rotation=process.env.BACKFILL_ROTATE==='true';
  const epochDay=Math.floor(Date.parse(now.toISOString().slice(0,10)+'T00:00:00Z')/86400000);
  const options = {
    month, now, existing: await readExisting(month),batchDays,
    startDay: Number(process.env.BACKFILL_START_DAY || 1),
    recheck: process.env.BACKFILL_RECHECK === 'true',
    dayOffset: rotation ? epochDay*batchDays : 0
  };
  const days = adaptive?adaptivePlan.tasks:planHistoricalDays(options).map(date=>({month,date}));
  if (!days.length) {
    console.log('Nenhum dia elegível para coleta histórica em ' + month +
      '. Cobertura existente preservada.');
    return;
  }
  console.log('Modo de recuperação: '+(prioritize?'NEs referenciadas sem documento':'cobertura recente')+'. Anos pendentes: '+priorityYears.join(', '));
  console.log('Plano histórico: ' + (adaptive?'adaptativo, '+adaptivePlan.eligibleMonths+' competencias elegiveis':month) + '; ' + days.length +
    ' dia(s) elegível(is) para o lote.');
  if (process.argv.includes('--dry-run')) {
    console.log('Simulação: nenhuma consulta e nenhum arquivo gravado.');
    return;
  }
  const token = process.env.CGU_API_KEY;
  if (!token) throw Error('CGU_API_KEY ausente no repositório');
  const budget=createCguBudget();
  let completedDays=0,partiallyRecoveredDays=0,failedPhases=0,totalDocs=0,attemptedDays=0,attemptedPhases=0,consultedPhases=0,deferredPhases=0,valuesRecovered=0,valuesAttempted=0,valuesUnresolved=0;
  const failureKinds={};
  for(const {month,date} of days){
    if(budget.stopped())break;
    attemptedDays++;
    const monthData=await readExisting(month);
    const result=await collectHistoricalDate({
      date,existing:monthData,recheck:options.recheck,listingOnly:!options.recheck,shouldStop:budget.stopped,
      collect:(value,phase)=>collectDayPhase(value,phase,{
        token,budget,deferLiquidationValues:!options.recheck&&!(monthData?.coverage||[]).some(c=>c.date===isoDate(value)&&c.phase===2&&c.complete&&c.invalid>0&&!canResumeLiquidations(monthData,c.date)),maxPages:process.env.CGU_MAX_PAGES || 30,
        maxImpactPages:process.env.CGU_MAX_IMPACT_PAGES || 8
      }),
      persist:async patch=>{
        const current=await readExisting(month);
        const collision=documentCollisionSummary(current,patch);
        const code=collisionCode(collision);
        if(code){
          const error=Error('Inconsistencia documental CGU');
          error.code=code;
          error.conflictCount=collision.otherDate+collision.otherPhase;
          throw error; // Nao modificar arquivo nem marcar fase como completa.
        }
        return persistWindow(process.cwd(),[patch],now);
      },
      logger:event=>{
        if(event.status==='failed')
          console.warn(event.date+': fase '+event.phase+' falhou ('+event.category+
            (event.count!==undefined?'; '+event.count+' colisao(oes)':'')+
            '); checkpoint preservado.');
        else if(event.status==='deferred')
          console.log(event.date+': fase '+event.phase+' adiada pelo limite operacional; nao e falha da API.');
        else if(event.status==='checkpoint_failed')
          console.error(event.date+': fase '+event.phase+
            ' falhou ao validar/gravar checkpoint ('+event.category+'); execução abortada.');
        else console.log(event.date+': fase '+event.phase+' '+event.status+
          '; '+event.count+' documento(s) consultado(s).');
      }
    });
    let latest=await readExisting(month),recovered=0;
    if(!options.recheck&&canResumeLiquidations(latest,isoDate(date))&&!budget.stopped()){
      const resume=await recoverLiquidationValues(latest,isoDate(date),{token,budget,slot:Math.floor(now.getTime()/43200000),now,
        persist:(id,value)=>persistEnrichment(process.cwd(),month,id,value,now)});
      latest=resume.data;recovered=resume.summary.recovered;
      valuesRecovered+=recovered;valuesAttempted+=resume.summary.attempted;valuesUnresolved+=resume.summary.unresolved;
      console.log(date+': recuperacao de valores de liquidacoes '+JSON.stringify(resume.summary));
    }
    const fullyComplete=options.recheck?result.fullyComplete:phasesMissingOnDate(latest,date).length===0;
    if(fullyComplete)completedDays++;
    if((result.consulted>0||recovered>0)&&!fullyComplete)partiallyRecoveredDays++;
    deferredPhases+=result.deferred;
    attemptedPhases+=result.attempted.length;
    consultedPhases+=result.consulted;
    failedPhases+=result.failed;
    totalDocs+=result.documents;
    for(const [kind,n] of Object.entries(result.failures))
      failureKinds[kind]=(failureKinds[kind]||0)+n;
  }
  await validatePublishedData(process.cwd());
  const measurement=budget.snapshot();
  console.log('Telemetria CGU backfill: '+JSON.stringify({adaptive,plannedDays:days.length,attemptedDays,completedDays,partiallyRecoveredDays,attemptedPhases,consultedPhases,failedPhases,deferredPhases,valuesRecovered,valuesAttempted,valuesUnresolved,documents:totalDocs,...measurement,limits:BACKFILL_LIMITS}));
  console.log('Resultado da coleta histórica: '+completedDays+
    ' dia(s) com tres fases completas; '+partiallyRecoveredDays+
    ' dia(s) com novas fases mas incompletos; '+failedPhases+
    ' falha(s) de fase; '+totalDocs+' documento(s) consultados; categorias: '+
    JSON.stringify(failureKinds)+'.');
  if(!completedDays&&!partiallyRecoveredDays)
    throw Error('Nenhuma fase concluida: checkpoints anteriores preservados');
}
main().catch(() => {
  console.error('Backfill CGU interrompido; dados de períodos anteriormente validados preservados.');
  process.exitCode = 1;
});

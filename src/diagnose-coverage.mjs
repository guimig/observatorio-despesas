/** Diagnóstico local do acervo: sem API, banco adicional ou dados pessoais. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {auditMonth, closedDaysInMonth} from '../assets/quality.js';

export function auditBaseline(report,{revision='unknown'}={}){
  return {
    schemaVersion:1,
    unit:'158459',
    revision,
    documents:report.documents,
    relations:report.relations,
    commitmentsCollected:report.commitmentsCollected,
    commitmentsReferenced:report.commitmentsReferenced,
    commitmentsMissing:report.commitmentsMissing,
    missingByYear:report.missingByYear,
    pendingEnrichment:report.pendingEnrichment,
    phaseObservations:report.phaseObservations||{total:0,overlappingDocuments:0,amountDisagreements:0},
    asOf:report.asOf||null,
    history:report.history||null,
    phaseCounts:report.phaseCounts||null,
    months:report.months.map(({month,daysWithCoverage,fullyCoveredDays,documents,relations,
      expectedDays,partialDays,missingDays,coveragePercent,
      pendingLiquidations,pendingPayments,pendingItems,pendingTotal})=>({
      month,daysWithCoverage,fullyCoveredDays,expectedDays,partialDays,missingDays,
      coveragePercent,documents,relations,
      pendingLiquidations,pendingPayments,pendingItems,pendingTotal
    })),
    caveat:report.note
  };
}

const VALID_MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;

function referenceMonth(now){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'
  }).formatToParts(now).map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month;
}

function nextMonth(month){
  const year=Number(month.slice(0,4)),number=Number(month.slice(5,7));
  return new Date(Date.UTC(year,number,1)).toISOString().slice(0,7);
}

/** Cobertura contra o calendario encerrado, incluindo competencias sem arquivo. */
export function historicalWindow(months,{now=new Date(),earliestMonth='2025-01'}={}){
  if(!Array.isArray(months)||!VALID_MONTH.test(earliestMonth))throw Error('Janela historica invalida');
  const current=referenceMonth(now),known=new Map(months.map(m=>[m.month,m]));
  const summary={from:earliestMonth,through:current,monthsExpected:0,monthsPublished:0,
    monthsMissing:[],closedDays:0,completeDays:0,partialDays:0,missingDays:0,percentComplete:null};
  for(let month=earliestMonth;month<=current;month=nextMonth(month)){
    const days=closedDaysInMonth(month,now);
    if(days===0)continue;
    summary.monthsExpected++;summary.closedDays+=days;
    const existing=known.get(month);
    if(!existing){summary.monthsMissing.push(month);summary.missingDays+=days;continue;}
    summary.monthsPublished++;
    const result=auditMonth(existing,{now}).coverage;
    summary.completeDays+=result.completeDays;
    summary.partialDays+=result.partialDays;
    summary.missingDays+=result.missingDays;
  }
  if(summary.closedDays)summary.percentComplete=Number((100*summary.completeDays/summary.closedDays).toFixed(2));
  return summary;
}

/** Resumo humano para o proprio GitHub Actions, sem identificadores SIAFI. */
export function baselineMarkdown(baseline){
  const history=baseline.history||{};
  const headline=history.closedDays?`${history.completeDays}/${history.closedDays} dias encerrados (${history.percentComplete}%)`:'sem janela configurada';
  const lines=[
    '## Observatorio de Despesas - auditoria CGU',
    `Revisao: ${baseline.revision} | referencia (Brasilia): ${baseline.asOf||'indisponivel'} | UG: ${baseline.unit}`,
    `Cobertura historica: **${headline}**. Competencias sem arquivo: ${history.monthsMissing?.length??'n/d'}.`,
    `Documentos canônicos: ${baseline.documents}; aparições adicionais em outras fases: ${baseline.phaseObservations?.total??0}; divergências de valores informados: ${baseline.phaseObservations?.amountDisagreements??0}; vínculos: ${baseline.relations}; NEs referenciadas sem documento: ${baseline.commitmentsMissing}; enriquecimentos pendentes: ${baseline.pendingEnrichment}.`,
    '',
    '| Competencia | Dias completos / encerrados | Parciais | Ausentes | Enriquecimentos pendentes |',
    '| --- | ---: | ---: | ---: | ---: |'
  ];
  for(const m of baseline.months)lines.push(`| ${m.month} | ${m.fullyCoveredDays}/${m.expectedDays??'?'} | ${m.partialDays??'?'} | ${m.missingDays??'?'} | ${m.pendingTotal} |`);
  lines.push('',
    'Uma fase consultada nao implica enriquecimento ou conciliacao contabile; ausencia de registro nunca equivale a despesa zero.');
  return lines.join('\n')+'\n';
}

export function diagnoseCoverage(months,{now=new Date(),earliestMonth='2025-01'}={}) {
  const docs=new Map(), refs=new Set(), phaseCount={1:0,2:0,3:0};
  const observedIds=new Set();
  let observedTotal=0,observedDisagreements=0;
  const monthsSummary=[];
  for(const month of months){
    for(const doc of month.documents){
      docs.set(doc.id,doc);
      phaseCount[doc.phase]=(phaseCount[doc.phase]||0)+1;
    }
    for(const item of month.phaseObservations||[]){
      observedIds.add(item.id);
      observedTotal++;
      if(item.amountRelation==='different')observedDisagreements++;
    }
    for(const relation of month.relations)refs.add(relation.to);
    const dates=new Set(month.coverage.map(c=>c.date));
    const complete=month.coverage.filter(c=>c.complete===true&&c.invalid===0);
    const fullyCovered=[...dates].filter(date=>[1,2,3].every(phase=>
      complete.some(c=>c.date===date&&c.phase===phase)));
    const audit=auditMonth(month,{now}).coverage;
    const pendingLiquidations=month.documents.filter(doc=>doc.phase===2&&doc.liquidationLinksChecked!==true).length;
    const pendingPayments=month.documents.filter(doc=>doc.phase===3&&doc.paymentLinksChecked!==true).length;
    const pendingItems=month.documents.filter(doc=>doc.phase===1&&!Object.hasOwn(month.itemsByDocument||{},doc.id)).length;
    monthsSummary.push({month:month.month,pendingLiquidations,pendingPayments,pendingItems,
      pendingTotal:pendingLiquidations+pendingPayments+pendingItems,daysWithCoverage:dates.size,
      fullyCoveredDays:fullyCovered.length,expectedDays:audit.expectedDays,
      partialDays:audit.partialDays,missingDays:audit.missingDays,
      coveragePercent:audit.expectedDays?Number((100*audit.completeDays/audit.expectedDays).toFixed(2)):null,
      documents:month.documents.length,relations:month.relations.length});
  }
  const known=new Set([...docs.values()].filter(d=>d.phase===1).map(d=>d.id));
  const missing=[...refs].filter(id=>!known.has(id)).sort();
  const missingByYear=Object.fromEntries([...new Set(missing.map(id=>id.slice(11,15)))].sort()
    .map(year=>[year,missing.filter(id=>id.slice(11,15)===year).length]));
  const pendingEnrichment=monthsSummary.reduce((total,month)=>total+month.pendingTotal,0);
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  return {months:monthsSummary,asOf,history:historicalWindow(months,{now,earliestMonth}),phaseCounts:phaseCount,
    phaseObservations:{total:observedTotal,overlappingDocuments:observedIds.size,amountDisagreements:observedDisagreements},
    pendingEnrichment,documents:docs.size,relations:months.reduce((n,m)=>n+m.relations.length,0),
    commitmentsCollected:known.size,commitmentsReferenced:refs.size,
    commitmentsMissing:missing.length,missingByYear,
    missingCommitmentIds:missing,
    note:'Referência sem documento não comprova ausência de empenho. Cobertura diária completa da consulta não equivale a conciliação SIAFI.'};
}
async function main(){
  const folder=join(process.cwd(),'data','months');
  const names=(await readdir(folder)).filter(n=>/^20\d{2}-(0[1-9]|1[0-2])\.json$/.test(n)).sort();
  const months=await Promise.all(names.map(async n=>JSON.parse(await readFile(join(folder,n),'utf8'))));
  const report=diagnoseCoverage(months);
  if(process.argv.includes('--audit-json')){
    console.log(JSON.stringify(auditBaseline(report,{revision:process.env.GITHUB_SHA||'unknown'}),null,2));
  }else if(process.argv.includes('--audit-md')){
    console.log(baselineMarkdown(auditBaseline(report,{revision:process.env.GITHUB_SHA||'unknown'})));
  }else if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
  else{
    console.log('Cobertura UG 158459: '+report.documents+' documentos; '+report.relations+' vínculos; '+
      report.commitmentsCollected+' NEs coletadas; '+report.commitmentsMissing+' NEs referenciadas sem documento; '+
      report.pendingEnrichment+' enriquecimentos pendentes.');
    console.log('Pendências por exercício: '+JSON.stringify(report.missingByYear));
    for(const m of report.months)console.log(m.month+': '+m.fullyCoveredDays+' dia(s) com três fases completas de '+m.daysWithCoverage+' dia(s) consultados; '+
      m.pendingTotal+' enriquecimentos pendentes (NS '+m.pendingLiquidations+', pagamento '+m.pendingPayments+', itens '+m.pendingItems+').');
    console.log(report.note);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(error=>{console.error(error.message);process.exitCode=1;});

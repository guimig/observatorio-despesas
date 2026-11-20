/** Diagnóstico local do acervo: sem API, banco adicional ou dados pessoais. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function diagnoseCoverage(months) {
  const docs=new Map(), refs=new Set(), phaseCount={1:0,2:0,3:0};
  const monthsSummary=[];
  for(const month of months){
    for(const doc of month.documents){
      docs.set(doc.id,doc);
      phaseCount[doc.phase]=(phaseCount[doc.phase]||0)+1;
    }
    for(const relation of month.relations)refs.add(relation.to);
    const dates=new Set(month.coverage.map(c=>c.date));
    const complete=month.coverage.filter(c=>c.complete===true&&c.invalid===0);
    const fullyCovered=[...dates].filter(date=>[1,2,3].every(phase=>
      complete.some(c=>c.date===date&&c.phase===phase)));
    const pendingLiquidations=month.documents.filter(doc=>doc.phase===2&&doc.liquidationLinksChecked!==true).length;
    const pendingPayments=month.documents.filter(doc=>doc.phase===3&&doc.paymentLinksChecked!==true).length;
    const pendingItems=month.documents.filter(doc=>doc.phase===1&&!Object.hasOwn(month.itemsByDocument||{},doc.id)).length;
    monthsSummary.push({month:month.month,pendingLiquidations,pendingPayments,pendingItems,
      pendingTotal:pendingLiquidations+pendingPayments+pendingItems,daysWithCoverage:dates.size,
      fullyCoveredDays:fullyCovered.length,documents:month.documents.length,
      relations:month.relations.length});
  }
  const known=new Set([...docs.values()].filter(d=>d.phase===1).map(d=>d.id));
  const missing=[...refs].filter(id=>!known.has(id)).sort();
  const missingByYear=Object.fromEntries([...new Set(missing.map(id=>id.slice(11,15)))].sort()
    .map(year=>[year,missing.filter(id=>id.slice(11,15)===year).length]));
  const pendingEnrichment=monthsSummary.reduce((total,month)=>total+month.pendingTotal,0);
  return {months:monthsSummary,pendingEnrichment,documents:docs.size,relations:months.reduce((n,m)=>n+m.relations.length,0),
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
  if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
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

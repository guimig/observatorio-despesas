/** Indice agregado derivado no build, nao uma segunda base de dados. */
import {buildIntegratedIndex,summarizeIntegratedCoverage} from '../assets/integrated-trajectory.js';
import {isIfcAdhesion} from '../assets/procurement-structured-filters.js';
import {scopeMonths,brazilMonth,FIRST_DATE,inScopeNe,closedCatalogCoverage} from './collection-scope.mjs';
import {currentDateInBrazil} from './backfill.mjs';
import {auditMonth,closedDaysInMonth} from '../assets/quality.js';
import {MODALITIES} from '../assets/pncp-modalities.js';
const ratio=(n,d)=>d?Number((100*n/d).toFixed(2)):null;
const latest=values=>values.filter(Boolean).sort().at(-1)||null;
const checked=(items,field)=>items.filter(x=>Boolean(x[field])).length;
function status(c,closed){
 if(!c)return 'missing';
 if(c.status!=='complete')return c.status;
 return closed&&!closedCatalogCoverage(c)?'unsealed':closed?'complete':'open';
}
export function buildCoverageIndex({months,manifest,procurement,notices,atas,tender,participants,now=new Date()}){
 const calendar=scopeMonths(now),current=brazilMonth(now),known=new Map(months.map(m=>[m.month,m]));
 const origin=new Set(),refs=new Set();
 const all=months.flatMap(m=>m.documents);
 for(const d of all)if(d.phase===1)origin.add(d.id);
 for(const m of months)for(const r of m.relations)refs.add(r.to);
 const missing=[...refs].filter(id=>!origin.has(id));
 const contracts=procurement?.contracts||[],publications=notices?.notices||[];
 const srp=publications.filter(n=>n.srp===true);
 const tenderItems=(tender?.procedures||[]).flatMap(p=>p.items);
 const ataIds=new Set((atas?.checks||[]).map(c=>c.procurementId));
 const tenderIds=new Set((tender?.procedures||[]).map(c=>c.pncpId));
 const participationIds=new Set((participants?.checks||[]).map(c=>c.ataId));
 const arpDetails=new Map((participants?.details||[]).map(d=>[d.ataId,d]));
 const allAtas=atas?.atas||[];
 const arpByYear=[...new Set(allAtas.map(a=>a.procurementId.slice(-4)))].sort().map(year=>{
  const rows=allAtas.filter(a=>a.procurementId.endsWith('/'+year));
  const ds=rows.map(a=>arpDetails.get(a.id)).filter(Boolean);
  return {year,atas:rows.length,participants:rows.filter(a=>participationIds.has(a.id)).length,
   items:ds.filter(d=>d.compras).length,instruments:ds.filter(d=>Object.hasOwn(d,'instruments')).length,
   files:ds.filter(d=>Object.hasOwn(d,'files')).length,fileLinks:ds.reduce((n,d)=>n+(d.files?.length||0),0)};
 });
 const contractCoverage=new Map((procurement?.coverage||[]).map(c=>[c.month+'/'+c.source,c]));
 const noticeCoverage=new Map((notices?.coverage||[]).map(c=>[c.month+'/'+c.modality,c]));
 const rows=calendar.map(month=>{
  const m=known.get(month),days=closedDaysInMonth(month,now),closed=month<current;
  const a=m?auditMonth(m,{now}):null;
  const completePhases=[1,2,3].map(phase=>(m?.coverage||[]).filter(c=>c.phase===phase&&c.complete&&c.invalid===0&&c.date<currentDateInBrazil(now)).length);
  const docs=m?.documents||[],items=Object.values(m?.itemsByDocument||{}).flat();
  const modalities=Object.keys(MODALITIES).map(k=>status(noticeCoverage.get(month+'/'+k),closed));
  return {month,days,completeDays:a?.coverage.completeDays||0,partialDays:a?.coverage.partialDays||0,
   missingDays:a?.coverage.missingDays??days,completePhases,documents:docs.length,
   pendingLiquidations:a?.enrichment.liquidations.pending||0,pendingPayments:a?.enrichment.payments.pending||0,
   pendingItems:docs.filter(d=>d.phase===1&&(!Object.hasOwn(m.itemsByDocument||{},d.id)||d.itemsDetailVersion!==2)).length,
   itemHistories:items.length,checkedHistories:items.filter(i=>i.historyChecked===true).length,
   missingDescriptions:docs.filter(d=>!d.description).length,phaseObservations:a?.phaseObservations.total||0,
   liquidationReviews:a?.links.liquidationValueReviews||0,updatedAt:m?.updated_at||null,
   pncp:status(contractCoverage.get(month+'/pncp'),closed),
   compras:status(contractCoverage.get(month+'/compras'),closed),
   modalities:Object.fromEntries(['complete','open','unsealed','partial','unavailable','missing'].map(k=>[k,modalities.filter(s=>s===k).length]))};
 });
 const sum=(key,list=rows)=>list.reduce((n,r)=>n+r[key],0);
 const byYear=[...new Set(rows.map(r=>r.month.slice(0,4)))].map(year=>{
  const list=rows.filter(r=>r.month.startsWith(year));
  return {year,days:sum('days',list),completeDays:sum('completeDays',list),partialDays:sum('partialDays',list),missingDays:sum('missingDays',list),
   completePhases:[0,1,2].map(i=>list.reduce((n,r)=>n+r.completePhases[i],0)),
   documents:sum('documents',list),pending:sum('pendingLiquidations',list)+sum('pendingPayments',list)+sum('pendingItems',list)};
 });
 const closed=rows.filter(r=>r.month<current);
 return {schemaVersion:1,unit:'158459',from:FIRST_DATE,asOf:currentDateInBrazil(now),
  source:'Indicadores derivados dos arquivos canonicos validados no build',
  revision:process.env.GITHUB_SHA||null,
  cgu:{months:rows.length,monthsWithFile:rows.filter(r=>known.has(r.month)).length,days:sum('days'),completeDays:sum('completeDays'),partialDays:sum('partialDays'),missingDays:sum('missingDays'),
   completePercent:ratio(sum('completeDays'),sum('days')),documents:sum('documents'),completePhases:[0,1,2].map(i=>rows.reduce((n,r)=>n+r.completePhases[i],0)),
   missingOrigins:missing.filter(inScopeNe).length,originsBeforeCutoff:missing.filter(id=>!inScopeNe(id)).length,
   pendingLiquidations:sum('pendingLiquidations'),pendingPayments:sum('pendingPayments'),pendingItems:sum('pendingItems'),
   pendingHistories:sum('itemHistories')-sum('checkedHistories'),missingDescriptions:sum('missingDescriptions'),phaseObservations:sum('phaseObservations'),liquidationReviews:sum('liquidationReviews'),
   lastCoveredDate:latest(months.flatMap(m=>m.coverage.filter(c=>c.complete&&c.invalid===0).map(c=>c.date))),
   lastDataWrite:latest(months.map(m=>m.updated_at)),manifestWrite:manifest?.updated_at||null},
  procurement:{closedMonths:closed.length,pncpMonths:closed.filter(r=>r.pncp==='complete').length,comprasMonths:closed.filter(r=>r.compras==='complete').length,
   modalitiesTotal:closed.length*Object.keys(MODALITIES).length,modalitiesComplete:closed.reduce((n,r)=>n+r.modalities.complete,0),
   contracts:contracts.length,notices:publications.length,contractsRechecked:checked(contracts,'recheckedAt'),noticesRechecked:checked(publications,'recheckedAt'),
   lastContractRevisionRecorded:latest(contracts.map(c=>c.recheckedAt)),lastNoticeRevisionRecorded:latest(publications.map(c=>c.recheckedAt)),
   lastContractsWrite:procurement?.updated_at||null,lastNoticesWrite:notices?.updated_at||null,deltaThrough:procurement?.pncpDelta?.through||null,
   pendingPublications:procurement?.pncpDelta?.pendingPublications?.length||0,
   commitmentLinksPending:contracts.filter(c=>c.source==='pncp'&&c.commitmentStatus!=='complete').length,
   purchaseLinksPending:contracts.filter(c=>c.source==='pncp'&&!c.procurementId).length,
   srp:srp.length,srpAtasChecked:srp.filter(n=>ataIds.has(n.pncpId)).length,srpItemsChecked:srp.filter(n=>tenderIds.has(n.pncpId)).length,
   tenderItems:tenderItems.length,itemResultsChecked:tenderItems.filter(i=>Object.hasOwn(i,'results')).length,
   itemResults:tenderItems.reduce((n,i)=>n+(i.results?.length||0),0),
   ifcAdhesionInstruments:contracts.filter(isIfcAdhesion).length,
   adhesionUnknown:contracts.filter(c=>c.source==='pncp'&&c.adhesion===undefined).length,
   arpUnitItems:(participants?.details||[]).reduce((n,d)=>n+(d.unitItems?.length||0),0),
   arpCampusUnitItems:(participants?.details||[]).reduce((n,d)=>n+(d.unitItems||[]).filter(i=>i.units.some(u=>u.unitCode==='158459')).length,0),
   arpItemsMatched:(participants?.details||[]).filter(d=>d.compras).length,
   arpItemRows:(participants?.details||[]).reduce((n,d)=>n+(d.compras?.items.length||0),0),
   arpInstrumentChecks:(participants?.details||[]).filter(d=>Object.hasOwn(d,'instruments')).length,
   arpInstrumentLinks:(participants?.details||[]).reduce((n,d)=>n+(d.instruments?.length||0),0),
   arpFilesChecked:(participants?.details||[]).filter(d=>Object.hasOwn(d,'files')).length,
   arpFilesAvailable:(participants?.details||[]).filter(d=>d.files?.length).length,
   arpFileLinks:(participants?.details||[]).reduce((n,d)=>n+(d.files?.length||0),0),
   arpByYear,
   lastAtaCheck:latest((atas?.checks||[]).map(c=>c.checkedAt)),lastParticipationCheck:latest((participants?.checks||[]).map(c=>c.checkedAt)),
   atas:atas?.atas?.length||0,ataParticipationChecked:(atas?.atas||[]).filter(a=>participationIds.has(a.id)).length},
  integrated:summarizeIntegratedCoverage(buildIntegratedIndex({months,contracts,notices:publications,atas:atas?.atas||[],arpDetails:participants?.details||[],tender,totalMonths:manifest?.months?.length??months.length})),
  years:byYear,months:rows};
}

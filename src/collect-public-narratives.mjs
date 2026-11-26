/** Reconsulta incremental apenas de textos historicos ausentes, sem resposta bruta. */
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readNotices,validateNotices} from './pncp-notices-store.mjs';
import {readProcurement,validateProcurement} from './procurement-store.mjs';
import {fetchNoticeDetail} from './pncp-notices-detail.mjs';
import {contractDetailUrl} from './pncp-contract-link.mjs';
import {requestPublicJSON} from './procurement.mjs';
import {createCguBudget} from './cgu-budget.mjs';
import {collectDayPhase} from './cgu.mjs';
import {planClassificationReview,applyClassificationPatch} from './cgu-classification-review.mjs';
import {persistWindow,validateMonth,validatePublishedData} from './store.mjs';
import {planNarrativeReviews,applyNarrativeReview,planCommitmentNarratives,planOtherDocumentNarratives,narrativeKey} from './narrative-review.mjs';
import {readOperationalState,saveOperationalState} from './operational-state.mjs';

async function atomicJson(path,object){
  const tmp=path+'.tmp';
  try{await writeFile(tmp,JSON.stringify(object)+'\n');await rename(tmp,path);}
  catch(error){await unlink(tmp).catch(()=>{});throw error;}
}
async function readMonths(root){
  const manifest=JSON.parse(await readFile(join(root,'data','manifest.json'),'utf8'));
  const months=[];
  for(const month of manifest.months||[]){
    const file=join(root,'data','months',month+'.json');
    months.push(validateMonth(JSON.parse(await readFile(file,'utf8'))));
  }
  return months;
}
const brDate=date=>date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);
export async function refreshNarratives({
  root=process.cwd(),now=new Date(),token=process.env.CGU_API_KEY||'',
  noticeDetail=fetchNoticeDetail,contractDetail=async id=>
    requestPublicJSON(contractDetailUrl(id)),
  collect=collectDayPhase,batch=5,commitmentDays=2,otherPhaseDays=1,classificationDays=0,dryRun=false,scope='all',budget,statePath
}={}){
  if(!['all','cgu','pncp'].includes(scope))throw Error('Escopo narrativo invalido');
  const state=await readOperationalState(statePath,{now}),today=now.toISOString().slice(0,10);
  const notices=scope==='cgu'?null:await readNotices(root),contracts=scope==='cgu'?null:await readProcurement(root);
  const months=scope==='pncp'?[]:await readMonths(root);
  const noticePlan=notices?planNarrativeReviews(notices,{kind:'notice',now,batch,state}):[];
  const contractPlan=contracts?planNarrativeReviews(contracts,{kind:'contract',now,batch,state}):[];
  const commitmentPlan=token&&scope!=='pncp'?planCommitmentNarratives(months,{now,batch:commitmentDays}):[];
  const otherPlan=token&&scope!=='pncp'?planOtherDocumentNarratives(months,{now,batch:otherPhaseDays}):[];
  const classificationPlan=token&&scope!=='pncp'?planClassificationReview(months,{now,batch:classificationDays,state,
    exclude:[...commitmentPlan.map(d=>d+'/1'),...otherPlan.map(x=>x.date+'/'+x.phase)]}):[];
  const report={notices:noticePlan.length,contracts:contractPlan.length,
    commitmentDates:commitmentPlan.length,otherDocumentDates:otherPlan.length,
    reviewedNotices:0,reviewedContracts:0,
    reviewedCommitmentDates:0,reviewedOtherDocumentDates:0,failures:0};
  if(classificationDays)Object.assign(report,{classificationDates:classificationPlan.length,reviewedClassificationDates:0,classifiedDocuments:0,classificationSkipped:0});
  if(dryRun)return report;
  let nextNotices=notices,nextContracts=contracts;
  for(const item of noticePlan){
    try{
      const fetched=await noticeDetail(item.pncpId);
      if(fetched?.pncpId!==item.pncpId)throw Error('ID PNCP divergente');
      const result=applyNarrativeReview(nextNotices,item.id,fetched.object??null,
        {kind:'notice',now,operational:Boolean(statePath)});
      nextNotices=result.data;report.reviewedNotices++;
      state[narrativeKey('notice',nextNotices.notices.find(n=>n.id===item.id))]=today;
    }catch{report.failures++;}
  }
  for(const item of contractPlan){
    try{
      const fetched=await contractDetail(item.pncpId);
      if(fetched?.numeroControlePNCP!==item.pncpId)throw Error('ID contratual divergente');
      const result=applyNarrativeReview(nextContracts,item.id,fetched.objetoContrato??null,
        {kind:'contract',now,operational:Boolean(statePath)});
      nextContracts=result.data;report.reviewedContracts++;
      state[narrativeKey('contract',nextContracts.contracts.find(n=>n.id===item.id))]=today;
    }catch{report.failures++;}
  }
  if(nextNotices && JSON.stringify(nextNotices)!==JSON.stringify(notices)){
    validateNotices(nextNotices);
    await atomicJson(join(root,'data','procurement','notices.json'),nextNotices);
  }
  if(nextContracts && JSON.stringify(nextContracts)!==JSON.stringify(contracts)){
    validateProcurement(nextContracts);
    await atomicJson(join(root,'data','procurement','contracts.json'),nextContracts);
  }
  for(const date of commitmentPlan){
    if(budget?.stopped())break;
    try{
      const patch=await collect(brDate(date),1,{token,maxPages:30,maxImpactPages:8,...(budget?{budget}:{})});
      if(patch.coverage.complete!==true||patch.coverage.invalid!==0){
        report.failures++;continue;
      }
      for(const doc of patch.documents)doc.descriptionCheckedAt=now.toISOString().slice(0,10);
      await persistWindow(root,[patch],now);
      report.reviewedCommitmentDates++;
    }catch{report.failures++;}
  }
  for(const item of otherPlan){
    if(budget?.stopped())break;
    try{
      const patch=await collect(brDate(item.date),item.phase,{token,maxPages:30,maxImpactPages:8,...(budget?{budget}:{})});
      if(patch.coverage.complete!==true||patch.coverage.invalid!==0){
        report.failures++;continue;
      }
      for(const doc of patch.documents)doc.descriptionCheckedAt=now.toISOString().slice(0,10);
      await persistWindow(root,[patch],now);
      report.reviewedOtherDocumentDates++;
    }catch{report.failures++;}
  }
  for(const item of classificationPlan){
    if(budget?.stopped())break;
    try{
      const patch=await collect(brDate(item.date),item.phase,{token,maxPages:30,deferLiquidationValues:true,...(budget?{budget}:{})});
      const path=join(root,'data','months',item.date.slice(0,7)+'.json');
      const month=validateMonth(JSON.parse(await readFile(path,'utf8')));
      const outcome=applyClassificationPatch(month,patch,{now,state:statePath?state:undefined});
      if(outcome.changed)await atomicJson(path,outcome.data);
      report.reviewedClassificationDates++;report.classifiedDocuments+=outcome.updated;
      report.classificationSkipped+=outcome.skipped;
    }catch{report.failures++;}
  }
  await validatePublishedData(root);
  await saveOperationalState(statePath,state,{now});
  if(budget)report.telemetry=budget.snapshot();
  return report;
}
async function main(){
  const scope=process.env.NARRATIVE_SCOPE||'all';
  const report=await refreshNarratives({scope,budget:scope==='pncp'?undefined:createCguBudget(),dryRun:process.argv.includes('--dry-run'),
    statePath:process.env.NARRATIVE_STATE_PATH,
    batch:Number(process.env.NARRATIVE_BATCH||5),
    commitmentDays:Number(process.env.NARRATIVE_CGU_DAYS||2),
    otherPhaseDays:Number(process.env.NARRATIVE_OTHER_PHASE_DAYS||1),
    classificationDays:Number(process.env.CGU_CLASSIFICATION_DAYS||0)});
  console.log('Revisao textual oficial: '+JSON.stringify(report)+
    '. Nenhum texto bruto, CPF, documento SIAFI, nome pessoal ou token nos logs.');
  if(!process.argv.includes('--dry-run') && report.failures &&
     !report.reviewedNotices&&!report.reviewedContracts&&
     !report.reviewedCommitmentDates&&!report.reviewedOtherDocumentDates&&!report.reviewedClassificationDates)
    throw Error('Fontes de narrativa indisponiveis; dados anteriores preservados');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(()=>{
    console.error('Reconsulta textual não concluída. Dados anteriores preservados.');
    process.exitCode=1;
  });
}

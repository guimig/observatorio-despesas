/** Reconsulta incremental apenas de textos historicos ausentes, sem resposta bruta. */
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readNotices,validateNotices} from './pncp-notices-store.mjs';
import {readProcurement,validateProcurement} from './procurement-store.mjs';
import {fetchNoticeDetail} from './pncp-notices-detail.mjs';
import {contractDetailUrl} from './pncp-contract-link.mjs';
import {requestPublicJSON} from './procurement.mjs';
import {collectDayPhase} from './cgu.mjs';
import {persistWindow,validateMonth,validatePublishedData} from './store.mjs';
import {planNarrativeReviews,applyNarrativeReview,planCommitmentNarratives} from './narrative-review.mjs';

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
  collect=collectDayPhase,batch=5,commitmentDays=2,dryRun=false
}={}){
  const notices=await readNotices(root),contracts=await readProcurement(root);
  const months=await readMonths(root);
  const noticePlan=notices?planNarrativeReviews(notices,{kind:'notice',now,batch}):[];
  const contractPlan=contracts?planNarrativeReviews(contracts,{kind:'contract',now,batch}):[];
  const commitmentPlan=token?planCommitmentNarratives(months,{now,batch:commitmentDays}):[];
  const report={notices:noticePlan.length,contracts:contractPlan.length,
    commitmentDates:commitmentPlan.length,reviewedNotices:0,reviewedContracts:0,
    reviewedCommitmentDates:0,failures:0};
  if(dryRun)return report;
  let nextNotices=notices,nextContracts=contracts;
  for(const item of noticePlan){
    try{
      const fetched=await noticeDetail(item.pncpId);
      if(fetched?.pncpId!==item.pncpId)throw Error('ID PNCP divergente');
      const result=applyNarrativeReview(nextNotices,item.id,fetched.object??null,
        {kind:'notice',now});
      nextNotices=result.data;report.reviewedNotices++;
    }catch{report.failures++;}
  }
  for(const item of contractPlan){
    try{
      const fetched=await contractDetail(item.pncpId);
      if(fetched?.numeroControlePNCP!==item.pncpId)throw Error('ID contratual divergente');
      const result=applyNarrativeReview(nextContracts,item.id,fetched.objetoContrato??null,
        {kind:'contract',now});
      nextContracts=result.data;report.reviewedContracts++;
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
    try{
      const patch=await collect(brDate(date),1,{token,maxPages:30,maxImpactPages:8});
      if(patch.coverage.complete!==true||patch.coverage.invalid!==0){
        report.failures++;continue;
      }
      for(const doc of patch.documents)doc.descriptionCheckedAt=now.toISOString().slice(0,10);
      await persistWindow(root,[patch],now);
      report.reviewedCommitmentDates++;
    }catch{report.failures++;}
  }
  await validatePublishedData(root);
  return report;
}
async function main(){
  const report=await refreshNarratives({dryRun:process.argv.includes('--dry-run'),
    batch:Number(process.env.NARRATIVE_BATCH||5),
    commitmentDays:Number(process.env.NARRATIVE_CGU_DAYS||2)});
  console.log('Revisao textual oficial: '+JSON.stringify(report)+
    '. Nenhum texto bruto, CPF, documento SIAFI, nome pessoal ou token nos logs.');
  if(!process.argv.includes('--dry-run') && report.failures &&
     !report.reviewedNotices&&!report.reviewedContracts&&!report.reviewedCommitmentDates)
    throw Error('Fontes de narrativa indisponiveis; dados anteriores preservados');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(()=>{
    console.error('Reconsulta textual não concluída. Dados anteriores preservados.');
    process.exitCode=1;
  });
}

/** Revisao direta por ID PNCP: so cataloga campos validados e metadados minimos. */
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readNotices,validateNotices} from './pncp-notices-store.mjs';
import {readProcurement,validateProcurement} from './procurement-store.mjs';
import {fetchNoticeDetail} from './pncp-notices-detail.mjs';
import {contractDetailUrl} from './pncp-contract-link.mjs';
import {requestPublicJSON,normalizePncp} from './procurement.mjs';
import {mergePncpRecord} from './pncp-record-revisions.mjs';

const DAY=86400000;
export function safePncpFailure(error,stage){
  const status=Number(error?.status);
  if(Number.isInteger(status)&&status>=400&&status<=599)
    return 'http_'+status;
  if(stage==='identity')return 'identity_mismatch';
  if(stage==='normalize')return 'normalization_failed';
  if(stage==='apply')return 'schema_or_provenance';
  return 'network_or_unexpected';
}
function frequency(record,kind,now){
  const baseline=kind==='notice'?record.published:record.signed||record.starts||
    record.publishedMonth+'-01';
  const age=now.getTime()-new Date(baseline+'T00:00:00Z').getTime();
  return age<30*DAY?7:age<180*DAY?30:90;
}
export function planPncpRevisions(data,{kind,now=new Date(),batch=4}={}){
  if(!['notice','contract'].includes(kind)||!Number.isSafeInteger(batch)||
    batch<1||batch>16||!Number.isFinite(now.getTime()))
    throw Error('Plano de revisao PNCP invalido');
  const entries=kind==='notice'?data?.notices:data?.contracts;
  if(!Array.isArray(entries))throw Error('Catalogo de revisoes ausente');
  const eligible=entries.filter(item=>item.source==='pncp'&&item.pncpId)
    .filter(item=>{
      const time=new Date((item.recheckedAt||'')+'T00:00:00Z').getTime();
      return !Number.isFinite(time)||now.getTime()-time>=frequency(item,kind,now)*DAY;
    }).sort((a,b)=>{
      const aCheck=a.recheckedAt||'',bCheck=b.recheckedAt||'';
      return aCheck.localeCompare(bCheck)||
        Number(Boolean(b.process?.startsWith('23349.')))-
        Number(Boolean(a.process?.startsWith('23349.')))||
        String(b.published||b.publishedMonth).localeCompare(String(a.published||a.publishedMonth))||
        a.id.localeCompare(b.id);
    });
  return eligible.slice(0,batch).map(item=>({id:item.id,pncpId:item.pncpId}));
}
function updateCatalog(original,id,incoming,kind,now){
  const validate=kind==='notice'?validateNotices:validateProcurement;
  const before=validate(structuredClone(original));
  const next=structuredClone(before);
  const list=kind==='notice'?next.notices:next.contracts;
  const index=list.findIndex(item=>item.id===id);
  if(index<0)throw Error('ID PNCP ausente do acervo');
  const result=mergePncpRecord(list[index],incoming,{kind,now,checked:true});
  if(result.stale)return {changed:false,materialChanged:false,stale:true,data:before};
  list[index]=result.record;
  validate(next);
  if(!result.changed)return {changed:false,materialChanged:false,stale:false,data:before};
  next.updated_at=now.toISOString();
  return {changed:true,materialChanged:result.materialChanged,stale:false,data:next};
}
export const applyNoticeRevision=(catalog,id,record,now)=>
  updateCatalog(catalog,id,record,'notice',now);
export const applyContractRevision=(catalog,id,record,now)=>
  updateCatalog(catalog,id,record,'contract',now);

async function atomic(path,data){
  const temp=path+'.tmp';
  try{await writeFile(temp,JSON.stringify(data)+'\n','utf8');await rename(temp,path);}
  catch(error){await unlink(temp).catch(()=>{});throw error;}
}
export async function recheckPncpRevisions({
  root=process.cwd(),now=new Date(),batch=4,dryRun=false,
  fetchNotice=fetchNoticeDetail,
  fetchContract=async id=>requestPublicJSON(contractDetailUrl(id))
}={}){
  const notices=await readNotices(root),contracts=await readProcurement(root);
  const noticePlan=notices?planPncpRevisions(notices,{kind:'notice',now,batch}):[];
  const contractPlan=contracts?planPncpRevisions(contracts,{kind:'contract',now,batch}):[];
  const report={noticePlanned:noticePlan.length,contractPlanned:contractPlan.length,
    noticeChecked:0,contractChecked:0,materialChanged:0,stale:0,failed:0,
    failureKinds:{}};
  if(dryRun)return report;
  let nextNotices=notices,nextContracts=contracts;
  for(const item of noticePlan){
    let stage='fetch';
    try{
      const normalized=await fetchNotice(item.pncpId);
      stage='apply';
      const result=applyNoticeRevision(nextNotices,item.id,normalized,now);
      nextNotices=result.data;
      if(result.stale)report.stale++;
      else{report.noticeChecked++;if(result.materialChanged)report.materialChanged++;}
    }catch(error){
      report.failed++;
      const category=safePncpFailure(error,stage);
      report.failureKinds[category]=(report.failureKinds[category]||0)+1;
    }
  }
  for(const item of contractPlan){
    let stage='fetch';
    try{
      const raw=await fetchContract(item.pncpId);
      stage='identity';
      if(raw?.numeroControlePNCP!==item.pncpId)throw Error('ID contrato divergente');
      stage='normalize';
      const normalized=normalizePncp(raw);
      if(!normalized)throw Error('Contrato PNCP invalido');
      stage='apply';
      const result=applyContractRevision(nextContracts,item.id,normalized,now);
      nextContracts=result.data;
      if(result.stale)report.stale++;
      else{report.contractChecked++;if(result.materialChanged)report.materialChanged++;}
    }catch(error){
      report.failed++;
      const category=safePncpFailure(error,stage);
      report.failureKinds[category]=(report.failureKinds[category]||0)+1;
    }
  }
  if(notices&&JSON.stringify(notices)!==JSON.stringify(nextNotices)){
    validateNotices(nextNotices);
    await atomic(join(root,'data/procurement/notices.json'),nextNotices);
  }
  if(contracts&&JSON.stringify(contracts)!==JSON.stringify(nextContracts)){
    validateProcurement(nextContracts);
    await atomic(join(root,'data/procurement/contracts.json'),nextContracts);
  }
  return report;
}
async function main(){
  const result=await recheckPncpRevisions({
    batch:Number(process.env.PNCP_REVISIONS_BATCH||4),
    dryRun:process.argv.includes('--dry-run')
  });
  console.log('Reconsulta PNCP por ID: '+JSON.stringify(result)+
    '. Contagens somente; nenhuma resposta bruta, CPF, fornecedor ou ID individual no log.');
  if(!process.argv.includes('--dry-run')&&result.failed>0&&
     result.noticeChecked+result.contractChecked===0)
    throw Error('Nenhuma reconsulta PNCP concluida: resultados antigos preservados');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(()=>{console.error('Reconsulta PNCP falhou; catálogo preservado.');
    process.exitCode=1;});
}

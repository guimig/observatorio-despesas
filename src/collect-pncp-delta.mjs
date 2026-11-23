/** Workflow de atualizacao PNCP: aplica apenas lotes completos e validados. */
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readProcurement,validateProcurement} from './procurement-store.mjs';
import {requestPublicJSON} from './procurement.mjs';
import {PNCP_DELTA_ORGS,planPncpDelta,scanPncpDelta,applyPncpDelta}
 from './pncp-delta.mjs';
import {recoverPncpPending} from './recover-pncp-publications.mjs';

function safeErrorCode(error){
 if(Number.isInteger(error?.status)&&error.status>=400&&error.status<=599)
   return 'http_'+error.status;
 const allowed=new Set(['invalid_query','invalid_envelope','invalid_count',
   'pagination_limit','pagination_changed','duplicated_pncp_id',
   'count_mismatch','invalid_contract','invalid_batch','checkpoint_conflict',
   'incomplete_source','invalid_or_repeated_id','missing_update_date',
   'invalid_date','invalid_clock','invalid_window','invalid_window_days',
   'checkpoint_in_future','invalid_page_limit']);
 return allowed.has(error?.code)?error.code:'network_or_schema_failure';
}
function optionsCount(value,defaultCount,max){
 const n=Number(value??defaultCount);
 if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('Limite invalido');
 return n;
}
/** Nenhum dado cru, CPF ou ID PNCP aparece no resultado do runner. */
export async function updatePncpDelta({
 root=process.cwd(),now=new Date(),dryRun=false,
 days=3,maxPages=20,fetcher=requestPublicJSON,
 wait=async()=>new Promise(r=>setTimeout(r,400))
}={}){
 const catalog=await readProcurement(root);
 if(!catalog)throw Error('Catalogo PNCP nao existente');
 const plan=planPncpDelta(catalog,{now,days});
 if(!plan)return {status:'up_to_date',changed:false,
   pncpAlreadyScannedThrough:catalog.pncpDelta?.through??null};
 if(dryRun)return {status:'dry_run',changed:false,window:plan};
 const scans=[];
 for(const org of PNCP_DELTA_ORGS){
   scans.push(await scanPncpDelta(plan.from,plan.to,org,{fetcher,maxPages,wait}));
 }
 const outcome=applyPncpDelta(catalog,plan,scans,{now});
 if(outcome.changed){
   const path=join(root,'data/procurement/contracts.json'),tmp=path+'.tmp';
   validateProcurement(outcome.data);
   try{
     await writeFile(tmp,JSON.stringify(outcome.data)+'\n','utf8');
     await rename(tmp,path);
   }catch(error){
     await unlink(tmp).catch(()=>{});
     throw error;
   }
 }
 return {status:'complete',changed:outcome.changed,
   window:plan,summary:outcome.summary,
   pncpAlreadyScannedThrough:outcome.data.pncpDelta.through};
}
async function main(){
 try{
   const result=await updatePncpDelta({
     root:resolve(process.cwd()),
     days:optionsCount(process.env.PNCP_DELTA_DAYS,3,7),
     maxPages:optionsCount(process.env.PNCP_DELTA_MAX_PAGES,20,20),
     dryRun:process.argv.includes('--dry-run')
   });
   console.log('Atualizacao incremental PNCP: '+JSON.stringify(result)+
     '. Apenas publicacoes PNCP; dados CGU e saldos de RAP inalterados.');
   // Recuperacao nao deve impedir versionamento de checkpoint ja verificado.
   // A fila e mantida se a API mensal estiver indisponivel.
   let recovery;
   try{
     recovery=await recoverPncpPending({
       root:resolve(process.cwd()),
       dryRun:process.argv.includes('--dry-run'),
       maxPages:optionsCount(process.env.PNCP_RECOVERY_MAX_PAGES,25,40)
     });
   }catch{
     recovery={status:'unexpected_failure',changed:false};
   }
   console.log('Recuperacao mensal PNCP: '+JSON.stringify(recovery)+
     '. Pendencias sem sucesso permanecem para proxima execucao.');
 }catch(error){
   console.error('Atualizacao PNCP bloqueada sem checkpoint: '+safeErrorCode(error));
   process.exitCode=1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 main();
}

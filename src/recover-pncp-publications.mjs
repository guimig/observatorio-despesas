/**
 * Recupera somente um mes de PUBLICACAO por execucao, para IDs PNCP
 * revelados por consulta de atualizacao. Nenhuma inferencia de UG financeira.
 * Pendencias ficam no catalogo e so saem apos verificacao do MES completo.
 */
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scanPncp} from './procurement.mjs';
import {mergeProcurement,readProcurement,validateProcurement} from './procurement-store.mjs';
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const MAX_PAGES=40;

export function planPncpRecovery(catalog,{now=new Date()}={}){
 validateProcurement(catalog);
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
   throw Error('Relogio invalido');
 const queue=catalog.pncpDelta?.pendingPublications??[];
 if(!queue.length)return null;
 const month=queue[0].publishedMonth;
 if(!MONTH.test(month))throw Error('Mes pendente invalido');
 // A data de publicacao precisa ser consultavel, nunca marcar mes futuro.
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',
   year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const values=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 const currentMonth=values.year+'-'+values.month;
 if(month>currentMonth)return {status:'future_month'};
 return {status:'ready',month,pendingInMonth:queue.filter(x=>
   x.publishedMonth===month).length};
}
function safeCode(error){
 if(Number.isInteger(error?.status)&&error.status>=400&&error.status<=599)
   return 'http_'+error.status;
 return 'network_or_schema_failure';
}
function atomicPath(root){return join(root,'data','procurement','contracts.json');}
/**
 * Sem scan completo + zero itens rejeitados + todos IDs esperados, o
 * lote nao e aplicado (mesmo que tenha novos dados aproveitaveis).
 */
export async function recoverPncpPending({
 root=process.cwd(),now=new Date(),dryRun=false,maxPages=25,
 scanFn=scanPncp
}={}){
 if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES)
   throw Error('Limite mensal PNCP invalido');
 const existing=await readProcurement(root);
 if(!existing)throw Error('Catalogo contratual inexistente');
 const plan=planPncpRecovery(existing,{now});
 if(!plan)return {status:'no_pending',changed:false};
 if(plan.status!=='ready')return {...plan,changed:false};
 if(dryRun)return {...plan,status:'dry_run',changed:false};
 let batch;
 try{batch=await scanFn(plan.month,{maxPages});}
 catch(error){return {status:'unavailable',reason:safeCode(error),
   changed:false,pendingInMonth:plan.pendingInMonth};}
 if(!batch||!Array.isArray(batch.records)||
    !Number.isSafeInteger(batch.skipped)||batch.skipped!==0||
    batch.records.some(x=>x?.source!=='pncp'||x.publishedMonth!==plan.month))
   return {status:'invalid_month_scan',changed:false,
     pendingInMonth:plan.pendingInMonth};
 const pendingIds=new Set(existing.pncpDelta.pendingPublications
   .filter(x=>x.publishedMonth===plan.month).map(x=>x.id));
 const present=new Set(batch.records.map(x=>x.id));
 const missing=[...pendingIds].filter(id=>!present.has(id)).length;
 if(missing)return {status:'unresolved_publications',changed:false,
   pendingInMonth:plan.pendingInMonth,missingCount:missing};
 let merged;
 try{
   merged=mergeProcurement(existing,[{
     source:'pncp',month:plan.month,status:'complete',
     records:batch.records,skipped:0
   }],now);
 }catch{
   return {status:'invalid_reconciliation',changed:false,
     pendingInMonth:plan.pendingInMonth};
 }
 const next=structuredClone(merged.data);
 const remaining=next.pncpDelta.pendingPublications.filter(x=>
   x.publishedMonth!==plan.month);
 if(remaining.length)next.pncpDelta.pendingPublications=remaining;
 else delete next.pncpDelta.pendingPublications;
 next.updated_at=now.toISOString();
 validateProcurement(next);
 const file=atomicPath(root),tmp=file+'.tmp';
 try{
   await writeFile(tmp,JSON.stringify(next)+'\n','utf8');
   await rename(tmp,file);
 }catch(error){
   await unlink(tmp).catch(()=>{});
   throw error;
 }
 return {status:'recovered',changed:true,month:plan.month,
   recoveredIds:pendingIds.size,remainingPending:remaining.length};
}
async function main(){
 const isDry=process.argv.includes('--dry-run');
 const max=Number(process.env.PNCP_RECOVERY_MAX_PAGES||25);
 try{
   const result=await recoverPncpPending({
     root:resolve(process.cwd()),dryRun:isDry,maxPages:max
   });
   console.log('Recuperacao publicacoes PNCP: '+JSON.stringify(result)+
     '. Nao representa saldo, pagamento ou RAP.');
 }catch{
   console.error('Recuperacao PNCP nao realizada; checkpoint original preservado.');
   process.exitCode=1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 main();

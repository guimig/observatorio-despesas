/** Fallback de disparos atrasados; sem consultar fontes financeiras nem criar commits.
 * A ultima tentativa (inclusive falha) evita martelar fonte ou fila. */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const WATCHED=Object.freeze([
 {file:'coleta-cgu.yml',hours:26,inputs:{}},
 {file:'backfill-cgu.yml',hours:6,inputs:{intensive:'true'}},
 {file:'enriquecer-cgu.yml',hours:6,inputs:{intensive:'true',liquidations:'30',payments:'36',items:'15'}},
 {file:'publicar-pages.yml',hours:4,inputs:{}},
 {file:'atualizar-contratos-pncp.yml',hours:26,inputs:{}},
 {file:'recuperar-origens-cgu.yml',hours:15,inputs:{limit:'15'}},
 {file:'coletar-itens-pncp.yml',hours:15,inputs:{}}
]);
export function overdueStatus(runs,hours,now=new Date()){
 if(!Array.isArray(runs)||!Number.isFinite(now.getTime())||!Number.isFinite(hours)||hours<=0||
   runs.some(r=>!r||typeof r.status!=='string'||!Number.isFinite(Date.parse(r.created_at))||Date.parse(r.created_at)>now.getTime()+60000))
   throw Error('Metadados de execucao invalidos');
 if(runs.some(r=>r.status!=='completed'))return {eligible:false,reason:'active'};
 const last=runs.reduce((max,r)=>Math.max(max,Date.parse(r.created_at)),0);
 const age=last?(now.getTime()-last)/3600000:null;
 return {eligible:last===0||age>=hours,reason:last===0?'never_run':age>=hours?'overdue':'recent',ageHours:age===null?null:Math.round(age*10)/10};
}
export async function monitorAgenda({token,repository='guimig/observatorio-despesas',now=new Date(),dryRun=false,fetcher=fetch,maxDispatch=3}={}){
 if(repository!=='guimig/observatorio-despesas'||typeof token!=='string'||!token||
   !Number.isSafeInteger(maxDispatch)||maxDispatch<1||maxDispatch>3)throw Error('Watchdog nao autorizado');
 const base='https://api.github.com/repos/'+repository+'/actions/workflows/';
 const headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'};
 const summary={dryRun,checked:0,dispatched:0,eligible:0,failed:0,workflows:[]};
 for(const target of WATCHED){
  let outcome;
  try{
   const r=await fetcher(base+target.file+'/runs?branch=main&per_page=30',{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('metadata');
   const body=await r.json();
   outcome=overdueStatus(body.workflow_runs,target.hours,now);
  }catch{summary.failed++;summary.workflows.push({workflow:target.file,reason:'metadata_unavailable'});continue}
  summary.checked++;
  const status={workflow:target.file,...outcome};summary.workflows.push(status);
  if(!outcome.eligible)continue;
  summary.eligible++;
  if(dryRun||summary.dispatched>=maxDispatch)continue;
  try{
   const r=await fetcher(base+target.file+'/dispatches',{method:'POST',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({ref:'main',inputs:target.inputs}),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(r.status!==204)throw Error('dispatch');
   status.dispatched=true;summary.dispatched++;
  }catch{status.dispatchFailed=true;summary.failed++}
 }
 return summary;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 monitorAgenda({token:process.env.GH_TOKEN,repository:process.env.GITHUB_REPOSITORY,
  dryRun:process.env.WATCHDOG_DRY_RUN==='true'}).then(r=>{
   console.log('Monitor de agenda (somente status): '+JSON.stringify(r));
   if(r.failed)process.exitCode=1;
  }).catch(()=>{console.error('Monitor de agenda interrompido sem expor credenciais.');process.exitCode=1});
}

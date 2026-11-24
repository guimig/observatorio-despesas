/** Coleta limitada de ARPs por compras SRP ja catalogadas, sem consultas por NE. */
import {readFile} from 'node:fs/promises';
import {readOperationalState,saveOperationalState,PURCHASE_KEY} from './operational-state.mjs';
import {fileURLToPath} from 'node:url';
import {scanAtas} from './pncp-atas.mjs';
import {readAtas,writeAtas} from './pncp-atas-store.mjs';
export function effectiveAtaChecks(checks,state,now=new Date()){
 const today=now.toISOString().slice(0,10);
 return checks.map(c=>{
  const stamp=state[c.procurementId];
  return typeof stamp==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(stamp)&&stamp<=today&&stamp>c.checkedAt
   ?{...c,checkedAt:stamp}:c;
 });
}
export function summarizeAtaCollection({notices,checks,atas},now=new Date()){
 const srp=notices.filter(n=>n.srp===true);
 const checked=new Map(checks.map(c=>[c.procurementId,c]));
 const byPurchase=new Set(atas.map(a=>a.procurementId));
 return {srp:srp.length,checked:srp.filter(n=>checked.has(n.pncpId)).length,
  unqueried:srp.filter(n=>!checked.has(n.pncpId)).length,
  checkedWithoutAtas:srp.filter(n=>checked.has(n.pncpId)&&!byPurchase.has(n.pncpId)).length,
  atas:atas.length,eligible:planAtas(srp,checks,now,50).length};
}
export function planAtas(notices,checks,now=new Date(),limit=12,offset=0){
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Limite invalido');
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Deslocamento invalido');
 const last=new Map(checks.map(c=>[c.procurementId,c.checkedAt]));
 const eligible=notices.filter(n=>n.srp===true&&
  (!last.has(n.pncpId)||now.getTime()-Date.parse(last.get(n.pncpId)+'T00:00:00Z')>=30*86400000));
 // Primeiro consultas nunca realizadas; depois revalidacao mensal.
 eligible.sort((a,b)=>Number(last.has(a.pncpId))-Number(last.has(b.pncpId))||
  String(b.published||'').localeCompare(String(a.published||''))||
  String(a.pncpId).localeCompare(String(b.pncpId)));
 // Rotacao deterministica: falhas persistentes nao bloqueiam o restante do acervo.
 if(!eligible.length)return [];
 const start=offset%eligible.length;
 return Array.from({length:Math.min(limit,eligible.length)},(_,i)=>eligible[(start+i)%eligible.length]);
}
async function main(){
 const root=process.cwd();
 const catalog=JSON.parse(await readFile('data/procurement/notices.json','utf8'));
 const previous=await readAtas(root);
 const limit=Number(process.env.PNCP_ATA_LIMIT||12);
 const day=Math.floor(Date.now()/86400000);
 const statePath=process.env.ATA_STATE_PATH;
 let state=await readOperationalState(statePath,{keyPattern:PURCHASE_KEY});
 const checks=effectiveAtaChecks(previous.checks,state);
 const plan=planAtas(catalog.notices,checks,new Date(),limit,day*limit);
 const before=summarizeAtaCollection({notices:catalog.notices,checks,atas:previous.atas});
 console.log('Cobertura ARP: '+JSON.stringify(before));
 console.log('Atas PNCP: '+plan.length+' compras SRP elegiveis; '+previous.atas.length+' atas catalogadas.');
 if(process.argv.includes('--dry-run'))return;
 const results=[];let failed=0;const errors={};
 for(const notice of plan){
  try{
   const atas=await scanAtas(notice);
   results.push({procurementId:notice.pncpId,atas});
  }catch(error){
   failed++;
   const category=error?.status===404?'not_found':error?.status===403?'forbidden':
    error?.status===429?'rate_limited':error?.status>=500?'server_error':
    error?.status?'http_other':/lista completa|paginada|incompleta|sequencial valido|duplicada/.test(error?.message||'')?'unexpected_shape':'other';
   errors[category]=(errors[category]||0)+1;
   console.warn('Consulta ARP '+notice.pncpId+' indisponivel ('+category+'); registro anterior preservado.');
  }
 }
 const outcome=await writeAtas(root,results);
 if(statePath){
  const next=Object.fromEntries(effectiveAtaChecks(outcome.data.checks,state).map(c=>[c.procurementId,c.checkedAt]));
  for(const r of results)next[r.procurementId]=new Date().toISOString().slice(0,10);
  await saveOperationalState(statePath,next,{keyPattern:PURCHASE_KEY});
  state=next;
 }
 console.log('Falhas por categoria: '+JSON.stringify(errors));
 console.log('Cobertura apos coleta: '+JSON.stringify(summarizeAtaCollection({notices:catalog.notices,checks:effectiveAtaChecks(outcome.data.checks,state),atas:outcome.data.atas})));
 console.log('Consultas concluidas: '+results.length+'; falhas: '+failed+
  '; atas: '+outcome.data.atas.length+'; alterado: '+outcome.changed);
}
if(process.argv[1]===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('Coleta de atas interrompida: '+e.message);process.exitCode=1});

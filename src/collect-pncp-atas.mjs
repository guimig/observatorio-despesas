/** Coleta limitada de ARPs por compras SRP ja catalogadas, sem consultas por NE. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {scanAtas} from './pncp-atas.mjs';
import {readAtas,writeAtas} from './pncp-atas-store.mjs';
export function summarizeAtaCollection({notices,checks,atas},now=new Date()){
 const srp=notices.filter(n=>n.srp===true);
 const checked=new Map(checks.map(c=>[c.procurementId,c]));
 const byPurchase=new Set(atas.map(a=>a.procurementId));
 return {srp:srp.length,checked:srp.filter(n=>checked.has(n.pncpId)).length,
  unqueried:srp.filter(n=>!checked.has(n.pncpId)).length,
  checkedWithoutAtas:srp.filter(n=>checked.has(n.pncpId)&&!byPurchase.has(n.pncpId)).length,
  atas:atas.length,eligible:planAtas(srp,checks,now,50).length};
}
export function planAtas(notices,checks,now=new Date(),limit=12){
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Limite invalido');
 const last=new Map(checks.map(c=>[c.procurementId,c.checkedAt]));
 const eligible=notices.filter(n=>n.srp===true&&
  (!last.has(n.pncpId)||now.getTime()-Date.parse(last.get(n.pncpId)+'T00:00:00Z')>=30*86400000));
 // Primeiro consultas nunca realizadas; depois revalidacao mensal.
 eligible.sort((a,b)=>Number(last.has(a.pncpId))-Number(last.has(b.pncpId))||
  String(b.published||'').localeCompare(String(a.published||'')));
 return eligible.slice(0,limit);
}
async function main(){
 const root=process.cwd();
 const catalog=JSON.parse(await readFile('data/procurement/notices.json','utf8'));
 const previous=await readAtas(root);
 const limit=Number(process.env.PNCP_ATA_LIMIT||12);
 const plan=planAtas(catalog.notices,previous.checks,new Date(),limit);
 const before=summarizeAtaCollection({notices:catalog.notices,checks:previous.checks,atas:previous.atas});
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
    error?.status?'http_other':error?.message?.includes('lista completa')?'unexpected_shape':'other';
   errors[category]=(errors[category]||0)+1;
   console.warn('Consulta ARP '+notice.pncpId+' indisponivel ('+category+'); registro anterior preservado.');
  }
 }
 const outcome=await writeAtas(root,results);
 console.log('Falhas por categoria: '+JSON.stringify(errors));
 console.log('Cobertura apos coleta: '+JSON.stringify(summarizeAtaCollection({notices:catalog.notices,checks:outcome.data.checks,atas:outcome.data.atas})));
 console.log('Consultas concluidas: '+results.length+'; falhas: '+failed+
  '; atas: '+outcome.data.atas.length+'; alterado: '+outcome.changed);
}
if(process.argv[1]===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('Coleta de atas interrompida: '+e.message);process.exitCode=1});

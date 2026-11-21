/** Coleta limitada de ARPs por compras SRP ja catalogadas, sem consultas por NE. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {scanAtas} from './pncp-atas.mjs';
import {readAtas,writeAtas} from './pncp-atas-store.mjs';
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
 console.log('Atas PNCP: '+plan.length+' compras SRP elegiveis; '+previous.atas.length+' atas catalogadas.');
 if(process.argv.includes('--dry-run'))return;
 const results=[];let failed=0;
 for(const notice of plan){
  try{
   const atas=await scanAtas(notice);
   results.push({procurementId:notice.pncpId,atas});
  }catch{
   failed++;
   console.warn('Consulta ARP indisponivel; registro anterior preservado.');
  }
 }
 const outcome=await writeAtas(root,results);
 console.log('Consultas concluidas: '+results.length+'; falhas: '+failed+
  '; atas: '+outcome.data.atas.length+'; alterado: '+outcome.changed);
}
if(process.argv[1]===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('Coleta de atas interrompida: '+e.message);process.exitCode=1});

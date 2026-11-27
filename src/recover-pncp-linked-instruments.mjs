/** Identidade reversa ata -> instrumento IFC. Sem nova base ou cobertura mensal presumida. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {contractDetailUrl} from './pncp-contract-link.mjs';
import {normalizePncp,requestPublicJSON} from './procurement.mjs';
import {readProcurement,writeDirectInstrument} from './procurement-store.mjs';
import {readAtas} from './pncp-atas-store.mjs';
import {validateParticipantReferences} from './collect-pncp-ata-participants.mjs';
import {inScopeMonth,brazilMonth} from './collection-scope.mjs';
const ID=/^(10635424000186|10635424000348)-2-\d{6}\/(20\d{2})$/;
export function planLinkedInstruments(catalog,details,{limit=8,slot=0}={}){
 if(!Number.isSafeInteger(limit)||limit<0||limit>12||!Number.isSafeInteger(slot)||slot<0)throw Error('Limite de recuperação inválido');
 const known=new Set((catalog?.contracts||[]).map(c=>c.pncpId)),pending=new Map();
 for(const d of details||[])for(const i of d.instruments||[]){
  const m=ID.exec(i.pncpId||'');if(!m||Number(m[2])<2024||known.has(i.pncpId))continue;
  const weight=i.unitCode==='158459'||m[1]==='10635424000348'?0:1;
  pending.set(i.pncpId,Math.min(weight,pending.get(i.pncpId)??1));
 }
 const rotate=rows=>rows.length?rows.slice(slot%rows.length).concat(rows.slice(0,slot%rows.length)):[];
 const priority=rotate([...pending].filter(([,w])=>w===0).map(([id])=>id).sort());
 const rest=rotate([...pending].filter(([,w])=>w===1).map(([id])=>id).sort());
 const first=priority.slice(0,Math.ceil(limit/2));
 return [...first,...rest,...priority.slice(first.length)].slice(0,limit);
}
export async function fetchLinkedInstrument(id,{fetcher=requestPublicJSON,now=new Date()}={}){
 const m=ID.exec(id||'');if(!m||Number(m[2])<2024)throw Error('Instrumento fora do recorte');
 const raw=await fetcher(contractDetailUrl(id));
 if(!raw||raw.numeroControlePNCP!==id)throw Error('Identidade PNCP divergente');
 const row=normalizePncp(raw);
 if(!row||row.pncpId!==id||row.orgCnpj!==m[1]||!inScopeMonth(row.publishedMonth)||row.publishedMonth>brazilMonth(now))
  throw Error('Instrumento PNCP nao validado');
 return row;
}
export async function recoverLinkedInstruments({root=process.cwd(),limit=8,slot=Math.floor(Date.now()/86400000),dryRun=false,now=new Date(),fetcher=requestPublicJSON,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const catalog=await readProcurement(root),atas=await readAtas(root);
 let data;try{data=validateParticipantReferences(JSON.parse(await readFile(join(root,'data','procurement','ata-participants.json'),'utf8')),atas.atas)}
 catch(e){if(e.code==='ENOENT')return {planned:0,attempted:0,recovered:0,failures:{}};throw e}
 const selected=planLinkedInstruments(catalog,data.details,{limit,slot});
 const result={planned:selected.length,attempted:0,recovered:0,failures:{}};
 if(dryRun)return result;
 for(const id of selected){
  if(result.attempted)await wait(5500);
  result.attempted++;
  try{const row=await fetchLinkedInstrument(id,{fetcher,now});const added=await writeDirectInstrument(root,row,now);if(added.changed)result.recovered++}
  catch(e){const reason=Number.isInteger(e?.status)?'http_'+e.status:'invalid_or_unavailable';result.failures[reason]=(result.failures[reason]||0)+1;if([401,403,429].includes(e?.status))break;}
 }
 return result;
}

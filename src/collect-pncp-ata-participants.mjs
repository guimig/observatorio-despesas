/** Coleta limitada: somente evidencias institucionais de participacao em ARPs. */
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {scanParticipants} from './pncp-ata-participants.mjs';
import {assertPublicSafe} from './privacy.mjs';
const path='data/procurement/ata-participants.json';
const empty=()=>({schema_version:1,checks:[]});
export function validateParticipants(value){
 assertPublicSafe(value);
 if(value?.schema_version!==1||!Array.isArray(value.checks)||
  Object.keys(value).some(k=>!['schema_version','checks'].includes(k)))throw Error('Catalogo de participacao invalido');
 const ids=new Set();
 for(const c of value.checks){
  if(!/^\d{14}-1-\d{6}\/20\d{2}:ata:\d+$/.test(c.ataId)||
    !/^20\d{2}-\d{2}-\d{2}$/.test(c.checkedAt)||
    !Array.isArray(c.campusRoles)||c.campusRoles.some(x=>![1,2,3].includes(x))||
    Object.keys(c).some(k=>!['ataId','checkedAt','campusRoles'].includes(k))||
    ids.has(c.ataId))throw Error('Evidencia ARP invalida');
  ids.add(c.ataId);
 }
 return value;
}
export function validateParticipantReferences(value,atas){
 validateParticipants(value);
 const ids=new Set(atas.map(a=>a.id));
 for(const check of value.checks){
  if(!ids.has(check.ataId))throw Error('Participacao vinculada a ata ausente do catalogo PNCP');
 }
 return value;
}
export function planParticipants(atas,checks,now=new Date(),limit=12){
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Limite invalido');
 const last=new Map(checks.map(c=>[c.ataId,c.checkedAt]));
 const eligible=atas.filter(a=>!last.has(a.id)||
  now.getTime()-Date.parse(last.get(a.id)+'T00:00:00Z')>=30*86400000);
 // Cobrir compras distintas antes de selecionar a segunda ata da mesma compra.
 // Sem isso, um pregão com centenas de atas monopoliza as execuções.
 const groups=new Map();
 for(const ata of eligible){
  if(!groups.has(ata.procurementId))groups.set(ata.procurementId,[]);
  groups.get(ata.procurementId).push(ata);
 }
 for(const group of groups.values())
  group.sort((a,b)=>Number(last.has(a.id))-Number(last.has(b.id))||
   a.sequence-b.sequence);
 const order=[...groups.keys()].sort((a,b)=>a.localeCompare(b));
 const result=[];
 while(result.length<limit&&order.length){
  for(let i=0;i<order.length&&result.length<limit;){
   const key=order[i],group=groups.get(key);
   result.push(group.shift());
   if(!group.length)order.splice(i,1);
   else i++;
  }
 }
 return result;
}
async function main(){
 const atas=JSON.parse(await readFile('data/procurement/atas.json','utf8')).atas;
 let data;try{data=validateParticipants(JSON.parse(await readFile(path,'utf8')))}
 catch(e){if(e.code==='ENOENT')data=empty();else throw e}
 validateParticipantReferences(data,atas);
 const limit=Number(process.env.PNCP_PARTICIPANTS_LIMIT||12);
 const plan=planParticipants(atas,data.checks,new Date(),limit);
 console.log('Compras distintas no lote: '+new Set(plan.map(a=>a.procurementId)).size);
 console.log('Participacao ARP: '+JSON.stringify({atas:atas.length,checked:data.checks.length,pending:plan.length}));
 if(process.argv.includes('--dry-run'))return;
 let success=0,failed=0,confirmed=0,candidate=0;
 const shapeTotals={};
 const now=new Date().toISOString().slice(0,10);
 for(const ata of plan){
  try{
   const result=await scanParticipants(ata);
   data.checks=data.checks.filter(c=>c.ataId!==ata.id);
   data.checks.push({ataId:ata.id,checkedAt:now,campusRoles:result.campusRoles});
   success++;if(result.campusRoles.length)confirmed++;
   if(result.candidateRoles.length)candidate++;
   for(const [key,value] of Object.entries(result.shape))shapeTotals[key]=(shapeTotals[key]||0)+value;
  }catch(e){failed++;console.warn('Consulta de participantes indisponivel para '+ata.id+' ('+
   (e.status?'HTTP '+e.status:'formato')+'); sem inferencia de participacao.')}
 }
 if(success){
  data.checks.sort((a,b)=>a.ataId.localeCompare(b.ataId));
  validateParticipants(data);
  try{await writeFile(path+'.tmp',JSON.stringify(data)+'\n');await rename(path+'.tmp',path)}
  catch(e){await unlink(path+'.tmp').catch(()=>{});throw e}
 }
 console.log('Formato PNCP (contagens agregadas, sem registros): '+JSON.stringify(shapeTotals));
 console.log('Participacao ARP: '+JSON.stringify({success,failed,confirmed,candidate,checked:data.checks.length}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error(e.message);process.exitCode=1});

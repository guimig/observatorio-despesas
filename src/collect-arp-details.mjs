/** Atualiza somente evidencias canonicas novas no catalogo de participacao. */
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {readOperationalState,saveOperationalState} from './operational-state.mjs';
import {validateParticipantReferences} from './collect-pncp-ata-participants.mjs';
import {applyArpDetail,planArpDetails,arpKey,scanComprasArp,scanAtaInstruments,inspectArpBalances,planArpUnitProbes,scanArpUnit,applyArpUnit} from './arp-details.mjs';
const path='data/procurement/ata-participants.json';
async function main(){
 const {atas}=JSON.parse(await readFile('data/procurement/atas.json','utf8'));
 const {notices}=JSON.parse(await readFile('data/procurement/notices.json','utf8'));
 const byNotice=new Map(notices.map(n=>[n.pncpId,n]));
 let data;
 try{data=JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;data={schema_version:1,checks:[]}}
 validateParticipantReferences(data,atas);
 const details=new Map((data.details||[]).map(d=>[d.ataId,d]));
 const statePath=process.env.ARP_DETAIL_STATE_PATH,state=await readOperationalState(statePath);
 const now=new Date(),today=now.toISOString().slice(0,10);
 const report={compras:{},instruments:{},units:{},balanceProbe:[]};
 const start=Date.now(),count=(kind,reason)=>{const r=report[kind];r[reason]=(r[reason]||0)+1};
 let changed=false,probeCount=0;
 // Sondagem independente: usa atas ja identificadas, mesmo sem novos itens.
 for(const task of planArpUnitProbes(atas,[...details.values()],{state,now})){
  if(Date.now()-start>90000)break;
  try{
   const result=await scanArpUnit(task.ata,task.compras,task.number);
   if(!result.ok){count('units',result.reason);state[task.key]=today;continue}
   const before=details.get(task.ata.id),next=applyArpUnit(before,task.ata,result.data);
   if(next!==before){details.set(task.ata.id,next);changed=true;count('units','changed')}
   state[task.key]=today;count('units','success');
   for(const u of result.data.units)count('units',u.unitCode==='158459'?'campusRows':'reitoriaRows');
  }catch(e){count('units',e.status?'http_'+e.status:'validation_or_conflict');if([401,403,429].includes(e.status))break}
 }
 for(const kind of ['compras','instruments']){
  const eligible=kind==='compras'?atas.filter(a=>a.starts&&byNotice.has(a.procurementId)):atas;
  const plan=planArpDetails(eligible,[...details.values()],{kind,state,now,limit:5});
  report[kind].planned=plan.length;
  for(const ata of plan){
   if(Date.now()-start>240000){count(kind,'deferred');break}
   try{
    const result=kind==='compras'?await scanComprasArp(ata,byNotice.get(ata.procurementId)): {ok:true,data:await scanAtaInstruments(ata)};
    if(!result.ok){count(kind,result.reason);state[arpKey(ata,kind)]=today;continue}
    const before=details.get(ata.id);
    const next=applyArpDetail(before,ata,kind,result.data);
    if(next!==before){details.set(ata.id,next);changed=true;count(kind,'changed')}
    state[arpKey(ata,kind)]=today;count(kind,'success');
    if(kind==='compras'){
     report.compras.items=(report.compras.items||0)+result.data.items.length;
     if(probeCount<2){probeCount++;report.balanceProbe.push(await inspectArpBalances(ata,result.data))}
    }else report.instruments.links=(report.instruments.links||0)+result.data.length;
   }catch(e){count(kind,e.status?'http_'+e.status:'validation_or_conflict');if([401,403,429].includes(e.status))break}
  }
 }
 if(changed){
  data.details=[...details.values()].sort((a,b)=>a.ataId.localeCompare(b.ataId));
  validateParticipantReferences(data,atas);
  try{await writeFile(path+'.tmp',JSON.stringify(data)+'\n');await rename(path+'.tmp',path)}
  catch(e){await unlink(path+'.tmp').catch(()=>{});throw e}
 }
 await saveOperationalState(statePath,state);
 console.log('Detalhes ARP (somente contagens e campos): '+JSON.stringify(report));
}
if(process.argv[1]===fileURLToPath(import.meta.url))
 main().catch(()=>{console.error('Coleta de detalhes ARP interrompida; dados anteriores preservados.');process.exitCode=1});

/** Catalogo minimo de ARPs: uma consulta completa vazia nao e falta de empenho. */
import {readFile,writeFile,rename,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {assertPublicSafe} from './privacy.mjs';
import {ataUrl} from './pncp-atas.mjs';
const fields=new Set(['id','procurementId','source','sequence','number','signed',
 'starts','ends','published','cancelledAt','cancelled','allowsAdhesion']);
export const emptyAtas=()=>({schema_version:1,atas:[],checks:[]});
export function validateAtas(data){
 assertPublicSafe(data);
 if(!data||data.schema_version!==1||!Array.isArray(data.atas)||
  !Array.isArray(data.checks)||Object.keys(data).some(k=>!['schema_version','atas','checks'].includes(k)))
  throw Error('Catalogo de atas invalido');
 const ids=new Set(),checked=new Set();
 for(const a of data.atas){
  if(Object.keys(a).some(k=>!fields.has(k)))throw Error('Campo ARP nao permitido');
  ataUrl(a.procurementId);
  if(a.source!=='pncp'||!Number.isSafeInteger(a.sequence)||a.sequence<1||
   a.id!==a.procurementId+':ata:'+a.sequence||ids.has(a.id))
   throw Error('Ata PNCP invalida/duplicada');
  ids.add(a.id);
 }
 for(const c of data.checks){
  if(Object.keys(c).some(k=>!['procurementId','checkedAt','status'].includes(k)))
   throw Error('Campo de consulta nao permitido');
  ataUrl(c.procurementId);
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(c.checkedAt)||c.status!=='complete'||
   checked.has(c.procurementId))throw Error('Consulta de ata invalida');
  checked.add(c.procurementId);
 }
 if(data.atas.some(a=>!checked.has(a.procurementId)))
  throw Error('Ata sem consulta de origem');
 return data;
}
export function mergeAtas(previous,results,now=new Date()){
 const data=structuredClone(validateAtas(previous||emptyAtas()));
 for(const result of results){
  const {procurementId,atas}=result;
  ataUrl(procurementId);
  if(!Array.isArray(atas)||atas.some(a=>a.procurementId!==procurementId))
   throw Error('Lote de atas invalido');
  const old=data.atas.filter(a=>a.procurementId===procurementId);
  const canonical=rows=>JSON.stringify(rows.map(a=>Object.fromEntries(Object.entries(a).sort(([x],[y])=>x.localeCompare(y)))).sort((a,b)=>a.id.localeCompare(b.id)));
  if(data.checks.some(c=>c.procurementId===procurementId)&&canonical(old)===canonical(atas))continue;
  data.atas=data.atas.filter(a=>a.procurementId!==procurementId).concat(atas);
  data.checks=data.checks.filter(c=>c.procurementId!==procurementId);
  data.checks.push({procurementId,status:'complete',checkedAt:now.toISOString().slice(0,10)});
 }
 data.atas.sort((a,b)=>a.id.localeCompare(b.id));
 data.checks.sort((a,b)=>a.procurementId.localeCompare(b.procurementId));
 return validateAtas(data);
}
export async function readAtas(root){
 try{return validateAtas(JSON.parse(await readFile(join(root,'data/procurement/atas.json'),'utf8')))}
 catch(e){if(e.code==='ENOENT')return emptyAtas();throw e}
}
export async function writeAtas(root,results,now=new Date()){
 const previous=await readAtas(root),next=mergeAtas(previous,results,now);
 if(JSON.stringify(next)===JSON.stringify(previous))return {changed:false,data:previous};
 const dir=join(root,'data/procurement'),path=join(dir,'atas.json');
 await mkdir(dir,{recursive:true});
 try{await writeFile(path+'.tmp',JSON.stringify(next)+'\n','utf8');await rename(path+'.tmp',path)}
 catch(e){await unlink(path+'.tmp').catch(()=>{});throw e}
 return {changed:true,data:next};
}

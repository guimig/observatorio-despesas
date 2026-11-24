/** Disposable scheduling state. Never contains raw source responses or financial records. */
import {readFile,stat,writeFile,rename,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const HASH_KEY=/^[a-f0-9]{64}$/;
export const PURCHASE_KEY=/^\d{14}-1-\d{6}\/20\d{2}$/;
export const MAX_STATE_BYTES=1024*1024;
export const STATE_DAYS=90;
const MAX_ENTRIES=10000;
export function validDay(value){
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export const stateKey=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function cleanState(input,{keyPattern=HASH_KEY,now=new Date()}={}){
 const today=now.toISOString().slice(0,10);
 const cutoff=new Date(now.getTime()-STATE_DAYS*86400000).toISOString().slice(0,10);
 if(!input||typeof input!=='object'||Array.isArray(input))return {};
 return Object.fromEntries(Object.entries(input)
  .filter(([key,value])=>keyPattern.test(key)&&validDay(value)&&value>=cutoff&&value<=today)
  .sort((a,b)=>b[1].localeCompare(a[1])||a[0].localeCompare(b[0])).slice(0,MAX_ENTRIES)
  .sort((a,b)=>a[0].localeCompare(b[0])));
}
export function effectiveDay(canonical,cached,now=new Date()){
 return validDay(cached)&&cached<=now.toISOString().slice(0,10)&&cached>(canonical||'')
  ?cached:canonical;
}
export async function readOperationalState(path,options){
 if(!path)return {};
 try{
  if((await stat(path)).size>MAX_STATE_BYTES)throw Error('size');
  return cleanState(JSON.parse(await readFile(path,'utf8')),options);
 }catch(e){
  if(e.code!=='ENOENT')console.warn('Cache operacional invalido ou inacessivel; usando checkpoints canonicos.');
  return {};
 }
}
export async function saveOperationalState(path,state,options){
 if(!path)return;
 const next=cleanState(state,options);
 const content=JSON.stringify(next)+'\n';
 let previous=null;
 try{if((await stat(path)).size<=MAX_STATE_BYTES)previous=await readFile(path,'utf8')}
 catch(e){if(e.code!=='ENOENT')console.warn('Cache anterior inacessivel; recriando estado.')}
 if(previous===content||previous===null&&!Object.keys(next).length)return;
 if(Buffer.byteLength(content)>MAX_STATE_BYTES)throw Error('Limite de cache operacional excedido');
 try{await writeFile(path+'.tmp',content);await rename(path+'.tmp',path)}
 catch(e){await unlink(path+'.tmp').catch(()=>{});console.warn('Cache operacional nao gravado; checkpoints canonicos preservados.')}
 console.log('Controle operacional: '+Object.keys(next).length+' checkpoints; '+Buffer.byteLength(content)+' bytes.');
}

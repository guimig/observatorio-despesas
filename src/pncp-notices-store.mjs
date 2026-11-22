/** Catálogo minimalista de editais, licitações e contratações diretas PNCP. */
import {readFile,writeFile,rename,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {assertPublicSafe} from './privacy.mjs';
import {publicNarrativeText} from './public-narrative.mjs';
import {normalizeProcess} from './procurement.mjs';
import {MODALITIES} from '../assets/pncp-modalities.js';

const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const DATE=/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/;
const ID=/^10635424000186-1-\d{6}\/20\d{2}$/;
const FIELDS=['id','pncpId','source','publicationUasg','month','modality',
  'number','process','unitCode','object','objectCheckedAt','estimatedCents','homologatedCents',
  'situation','srp','published','disputeMode','legalBasisCode',
  'proposalStart','proposalEnd'];
export const blankNotices=()=>({
  schema_version:1,publicationUasg:'158125',notices:[],coverage:[]
});
function whitelist(value,allowed) {
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).some(key=>!allowed.includes(key)))throw Error('Campo não permitido');
}
function validDate(s){
  if(typeof s!=='string'||!DATE.test(s))return false;
  const d=new Date(s+'T00:00:00Z');
  return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;
}
export function validateNotices(data){
  assertPublicSafe(data);
  whitelist(data,['schema_version','publicationUasg','notices','coverage','updated_at']);
  if(data.schema_version!==1||data.publicationUasg!=='158125'||
     !Array.isArray(data.notices)||!Array.isArray(data.coverage)) {
    throw Error('Catálogo de publicações inválido');
  }
  const ids=new Set();
  for(const n of data.notices){
    whitelist(n,FIELDS);
    if(!ID.test(n.pncpId??'')||n.id!=='pncp:'+n.pncpId||
       n.source!=='pncp'||n.publicationUasg!=='158125'||
       !MONTH.test(n.month)||!Object.hasOwn(MODALITIES,n.modality)||
       !validDate(n.published)||n.published.slice(0,7)!==n.month||ids.has(n.id)) {
      throw Error('Publicação PNCP inválida/duplicada');
    }
    ids.add(n.id);
    for(const field of ['number','unitCode']){
      if(n[field]!==undefined &&
         (typeof n[field]!=='string'||n[field].length>65||
          !/^[a-zA-Z0-9/._ -]+$/.test(n[field])))throw Error('Código de publicação inválido');
    }
    if(n.process!==undefined&&normalizeProcess(n.process)!==n.process)
      throw Error('Processo de publicação inválido');
    if(n.object!==undefined&&publicNarrativeText(n.object)!==n.object)
      throw Error('Objeto de publicação não sanitizado');
    if(n.objectCheckedAt!==undefined&&!validDate(n.objectCheckedAt))
      throw Error('Data de revisão narrativa inválida');
    for(const field of ['estimatedCents','homologatedCents']){
      if(n[field]!==undefined&&!Number.isSafeInteger(n[field]))
        throw Error('Valor de publicação inválido');
    }
    if(n.situation!==undefined&&(!Number.isSafeInteger(n.situation)||
       n.situation<0||n.situation>1000))throw Error('Situação PNCP inválida');
    if(n.srp!==undefined&&typeof n.srp!=='boolean')throw Error('SRP inválido');
    for(const field of ['disputeMode','legalBasisCode']){
      if(n[field]!==undefined&&(!Number.isSafeInteger(n[field])||n[field]<0||n[field]>10000))
        throw Error('Código PNCP inválido');
    }
    for(const field of ['proposalStart','proposalEnd']){
      if(n[field]!==undefined&&!validDate(n[field]))throw Error('Prazo PNCP inválido');
    }
  }
  const cover=new Set();
  for(const c of data.coverage){
    whitelist(c,['month','modality','status','count','skipped','httpStatus']);
    const k=c.month+'/'+c.modality;
    if(!MONTH.test(c.month)||!Object.hasOwn(MODALITIES,c.modality)||
       !['complete','partial','unavailable'].includes(c.status)||cover.has(k)||
       c.count!==undefined&&(!Number.isSafeInteger(c.count)||c.count<0)||
       c.skipped!==undefined&&(!Number.isSafeInteger(c.skipped)||c.skipped<0)||
       c.httpStatus!==undefined&&(!Number.isInteger(c.httpStatus)||
         c.httpStatus<0||c.httpStatus>599)){
      throw Error('Cobertura PNCP inválida');
    }
    cover.add(k);
    if(c.status==='complete'&&(c.skipped>0||
       c.count!==data.notices.filter(n=>n.month===c.month&&n.modality===c.modality).length))
      throw Error('Modalidade PNCP com cobertura divergente');
  }
  for(const n of data.notices)if(!cover.has(n.month+'/'+n.modality)){
    throw Error('Publicação PNCP sem cobertura');
  }
  return data;
}
const serialize=value=>{
  const recursive=x=>Array.isArray(x)?x.map(recursive):
    x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort()
      .map(k=>[k,recursive(x[k])])):x;
  const data=structuredClone(value);delete data.updated_at;
  return JSON.stringify(recursive(data));
};
export function mergeNotices(previous,scans,now=new Date()){
  const before=validateNotices(structuredClone(previous||blankNotices()));
  const next=structuredClone(before);
  for(const scan of scans){
    const {month,modality,status,records=[],skipped=0,httpStatus}=scan;
    if(!MONTH.test(month)||!Object.hasOwn(MODALITIES,modality)||
       !['complete','partial','unavailable'].includes(status)||
       !Array.isArray(records)||!Number.isSafeInteger(skipped)||skipped<0){
      throw Error('Lote de modalidades inválido');
    }
    const current=next.coverage.find(c=>c.month===month&&c.modality===Number(modality));
    if(current?.status==='complete'&&status!=='complete')continue;
    if(status==='unavailable'&&current?.status==='partial')continue;
    if(status==='partial'&&current?.status==='partial'&&
      (current.count??0)>=records.length)continue;
    if(status!=='unavailable') {
      if(status==='complete'||!current){
        const previousById=new Map(next.notices.map(n=>[n.id,n]));
        next.notices=next.notices.filter(n=>!(n.month===month&&n.modality===Number(modality)));
        for(const original of records){
          const copy=structuredClone(original),prior=previousById.get(copy.id);
          if(prior?.object&&!copy.object)copy.object=prior.object;
          if(prior?.objectCheckedAt)copy.objectCheckedAt=prior.objectCheckedAt;
          next.notices.push(copy);
        }
      }
    }
    next.coverage=next.coverage.filter(c=>!(c.month===month&&c.modality===Number(modality)));
    next.coverage.push({month,modality:Number(modality),status,
      ...(status==='unavailable'?{httpStatus:httpStatus??0}:{count:records.length,skipped})});
  }
  next.notices.sort((a,b)=>a.id.localeCompare(b.id));
  next.coverage.sort((a,b)=>a.month.localeCompare(b.month)||a.modality-b.modality);
  validateNotices(next);
  if(serialize(next)===serialize(before))return {changed:false,data:before};
  next.updated_at=now.toISOString();
  return {changed:true,data:next};
}
/**
 * Inclui publicação individual comprovada sem alegar cobertura mensal completa.
 * Usa somente o JSON canônico de publicações e preserva modalidades já coletadas.
 */
export function applyDirectNotice(existing,notice,now=new Date()) {
  const original=validateNotices(structuredClone(existing||blankNotices()));
  if(original.notices.some(row=>row.pncpId===notice?.pncpId)){
    return {changed:false,data:original};
  }
  const next=structuredClone(original);
  next.notices.push(structuredClone(notice));
  next.notices.sort((a,b)=>a.id.localeCompare(b.id));
  const i=next.coverage.findIndex(c=>c.month===notice.month &&
    c.modality===notice.modality);
  const count=next.notices.filter(n=>n.month===notice.month &&
    n.modality===notice.modality).length;
  const partial={month:notice.month,modality:notice.modality,
    status:'partial',count,skipped:0};
  // Detalhe individual não autoriza afirmar que o mês/modalidade está completo.
  if(i>=0)next.coverage[i]=partial;
  else next.coverage.push(partial);
  next.coverage.sort((a,b)=>a.month.localeCompare(b.month)||a.modality-b.modality);
  validateNotices(next);
  next.updated_at=now.toISOString();
  return {changed:true,data:next};
}
export async function writeDirectNotice(root,notice,now=new Date()) {
  const folder=join(root,'data','procurement');
  const path=join(folder,'notices.json');
  const result=applyDirectNotice(await readNotices(root),notice,now);
  if(!result.changed)return result;
  await mkdir(folder,{recursive:true});
  const tmp=path+'.tmp';
  try{
    await writeFile(tmp,JSON.stringify(result.data)+'\n','utf8');
    await rename(tmp,path);
  }catch(error){await unlink(tmp).catch(()=>{});throw error}
  return result;
}

export async function readNotices(root){
  const path=join(root,'data','procurement','notices.json');
  try{return validateNotices(JSON.parse(await readFile(path,'utf8')))}
  catch(e){if(e.code==='ENOENT')return null;throw e}
}
export async function writeNotices(root,scans,now=new Date()){
  const folder=join(root,'data','procurement'),path=join(folder,'notices.json');
  const outcome=mergeNotices(await readNotices(root),scans,now);
  if(!outcome.changed)return outcome;
  await mkdir(folder,{recursive:true});
  const tmp=path+'.tmp';
  try{await writeFile(tmp,JSON.stringify(outcome.data)+'\n','utf8');await rename(tmp,path);}
  catch(e){await unlink(tmp).catch(()=>{});throw e}
  return outcome;
}

/** Catálogo contratual único, sem duplicar documentos CGU ou versões anteriores. */
import {readFile,writeFile,rename,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {assertPublicSafe} from './privacy.mjs';
import {publicItemDescription} from './enrich-cgu.mjs';
import {CAMPUS_UG,CAMPUS_CNPJ,REITORIA_CNPJ,normalizeProcess} from './procurement.mjs';

const SOURCE=new Set(['pncp','compras']);
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const PNCP_ID=/^\d{14}-[1-9]-\d{6}\/20\d{2}$/;
const CPF=/^\*\*\*\.\d{3}\.\d{3}-\*\*$/;
const CNPJ=/^\d{14}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const FIELDS=['id','source','scope','orgCnpj','publishedMonth','number',
 'pncpId','procurementId','process','unitCode','signed','starts','ends',
 'amountCents','supplierCnpj','supplierCpfMasked','supplierName','object','kind'];

export const blankProcurement=()=>({
  schema_version:1,unit:CAMPUS_UG,contracts:[],coverage:[]
});
function exactKeys(obj,keys){
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    Object.keys(obj).some(key=>!keys.includes(key)))throw Error('Campo externo não autorizado');
}
function optionalString(value,max,validator=()=>true){
  return value===undefined ||
    typeof value==='string'&&value.length>0&&value.length<=max&&validator(value);
}
function date(value){
  if(value===undefined)return true;
  if(typeof value!=='string'||!DATE.test(value))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
}
export function validateProcurement(data){
  assertPublicSafe(data);
  exactKeys(data,['schema_version','unit','contracts','coverage','updated_at']);
  if(data.schema_version!==1||data.unit!==CAMPUS_UG||
     !Array.isArray(data.contracts)||!Array.isArray(data.coverage))throw Error('Catálogo inválido');
  if(data.updated_at!==undefined &&
     (typeof data.updated_at!=='string'||!Number.isFinite(Date.parse(data.updated_at))))
    throw Error('Carimbo de atualização inválido');
  const unique=new Set();
  for(const contract of data.contracts){
    exactKeys(contract,FIELDS);
    if(typeof contract.id!=='string'||contract.id.length>130||
       !SOURCE.has(contract.source)||!['campus','ifc'].includes(contract.scope)||
       !MONTH.test(contract.publishedMonth) || unique.has(contract.id)) {
      throw Error('Contrato inválido ou duplicado');
    }
    unique.add(contract.id);
    if(contract.source==='pncp'){
      if(!PNCP_ID.test(contract.pncpId??'') ||
         contract.id!=='pncp:'+contract.pncpId ||
         ![CAMPUS_CNPJ,REITORIA_CNPJ].includes(contract.orgCnpj) ||
         (contract.scope==='campus' &&
          contract.orgCnpj!==CAMPUS_CNPJ&&contract.unitCode!==CAMPUS_UG))
        throw Error('Identificação ou escopo PNCP inválidos');
    }else if(!contract.id.startsWith('compras:'+CAMPUS_UG+':')||
             contract.scope!=='campus'||contract.unitCode!==CAMPUS_UG) {
      throw Error('Identificação Compras.gov inválida');
    }
    if(contract.procurementId!==undefined&&!PNCP_ID.test(contract.procurementId))
      throw Error('Referência de contratação PNCP inválida');
    if(contract.process!==undefined && normalizeProcess(contract.process)!==contract.process)
      throw Error('Processo administrativo inválido');
    if(contract.orgCnpj!==undefined && !CNPJ.test(contract.orgCnpj))
      throw Error('CNPJ institucional inválido');
    if(!optionalString(contract.unitCode,25,v=>/^[A-Za-z0-9_./ -]+$/.test(v))||
       !optionalString(contract.number,65,v=>/^[A-Za-z0-9_./ -]+$/.test(v))||
       !date(contract.signed)||!date(contract.starts)||!date(contract.ends)||
       contract.amountCents!==undefined&&!Number.isSafeInteger(contract.amountCents))
      throw Error('Campos contratuais inválidos');
    if(contract.supplierCnpj!==undefined && !CNPJ.test(contract.supplierCnpj))
      throw Error('CNPJ de fornecedor inválido');
    if(contract.supplierCpfMasked!==undefined &&
       (!CPF.test(contract.supplierCpfMasked)||contract.supplierCnpj!==undefined))
      throw Error('CPF de fornecedor não mascarado');
    if(contract.supplierName!==undefined &&
       (!contract.supplierCnpj ||
         publicItemDescription(contract.supplierName,150)!==contract.supplierName))
      throw Error('Nome de fornecedor não sanitizado');
    for(const [key,max] of [['object',260],['kind',80]]){
      if(contract[key]!==undefined &&
         publicItemDescription(contract[key],max)!==contract[key])
        throw Error('Texto contratual livre não sanitizado');
    }
  }
  const coverageKeys=new Set();
  for(const c of data.coverage){
    exactKeys(c,['source','month','status','count','skipped','httpStatus']);
    if(!SOURCE.has(c.source)||!MONTH.test(c.month) ||
       !['complete','partial','unavailable'].includes(c.status)||
       (c.count!==undefined&&(!Number.isSafeInteger(c.count)||c.count<0))||
       (c.skipped!==undefined&&(!Number.isSafeInteger(c.skipped)||c.skipped<0))||
       (c.httpStatus!==undefined&&(!Number.isInteger(c.httpStatus)||c.httpStatus<0||c.httpStatus>599))||
       coverageKeys.has(c.source+'/'+c.month))throw Error('Cobertura contratual inválida');
    coverageKeys.add(c.source+'/'+c.month);
    if(c.status==='complete'&&c.skipped>0)throw Error('Cobertura completa apesar de registros rejeitados');
    if(c.status==='complete' &&
       c.count!==data.contracts.filter(v=>v.source===c.source&&v.publishedMonth===c.month).length)
      throw Error('Cobertura contratual diverge dos registros');
  }
  for(const record of data.contracts){
    if(!coverageKeys.has(record.source+'/'+record.publishedMonth))
      throw Error('Contrato sem cobertura da origem');
  }
  return data;
}
export function mergeProcurement(current,scans,now=new Date()){
  const previous=validateProcurement(structuredClone(current??blankProcurement()));
  const next=structuredClone(previous);
  for(const scan of scans){
    const {source,month,records,skipped=0,status='complete',httpStatus}=scan;
    if(!SOURCE.has(source)||!MONTH.test(month)||!Array.isArray(records)||
       !['complete','partial','unavailable'].includes(status)||
       !Number.isSafeInteger(skipped)||skipped<0)throw Error('Lote contratual inválido');
    const before=next.coverage.find(item=>item.source===source&&item.month===month);
    if(before?.status==='complete' && status!=='complete')continue;
    if(status==='unavailable'&&before?.status==='partial')continue;
    if(status==='partial'&&before?.status==='partial'&&
       (before.count??0)>=records.length)continue;
    if(status!=='unavailable'){
      // Apenas um lote paginado concluído pode substituir registros já publicados.
      if(status==='complete'||!before){
        next.contracts=next.contracts.filter(entry=>
          entry.source!==source||entry.publishedMonth!==month);
        next.contracts.push(...structuredClone(records));
      }
    }
    next.coverage=next.coverage.filter(item=>item.source!==source||item.month!==month);
    next.coverage.push({source,month,status,...(status==='unavailable'?
      {httpStatus:httpStatus??0}:{count:records.length,skipped})});
  }
  next.contracts.sort((a,b)=>a.source.localeCompare(b.source)||a.id.localeCompare(b.id));
  next.coverage.sort((a,b)=>a.month.localeCompare(b.month)||a.source.localeCompare(b.source));
  validateProcurement(next);
  const canonical=obj=>{const value=structuredClone(obj);delete value.updated_at;return JSON.stringify(value)};
  if(canonical(next)===canonical(previous))return {changed:false,data:previous};
  next.updated_at=now.toISOString();
  return {changed:true,data:next};
}
export async function readProcurement(root){
  const filename=join(root,'data','procurement','contracts.json');
  try{return validateProcurement(JSON.parse(await readFile(filename,'utf8')))}
  catch(error){if(error.code==='ENOENT')return null;throw error}
}
export async function writeProcurement(root,scans,now=new Date()){
  const filename=join(root,'data','procurement','contracts.json');
  const current=await readProcurement(root);
  const outcome=mergeProcurement(current,scans,now);
  if(!outcome.changed)return outcome;
  await mkdir(join(root,'data','procurement'),{recursive:true});
  const tmp=filename+'.tmp';
  try{
    await writeFile(tmp,JSON.stringify(outcome.data)+'\n','utf8');
    await rename(tmp,filename);
  }catch(error){await unlink(tmp).catch(()=>{});throw error}
  return outcome;
}

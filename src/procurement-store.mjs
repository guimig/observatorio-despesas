/** Catálogo contratual único, sem duplicar documentos CGU ou versões anteriores. */
import {readFile,writeFile,rename,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {assertPublicSafe} from './privacy.mjs';
import {publicItemDescription} from './enrich-cgu.mjs';
import {publicNarrativeText} from './public-narrative.mjs';
import {CAMPUS_UG,CAMPUS_CNPJ,REITORIA_CNPJ,normalizeProcess} from './procurement.mjs';
import {CONTRACT_FIELDS} from './pncp-record-revisions.mjs';
import {validateCommitmentMetadata,validateContextualCommitments} from './pncp-commitment-fields.mjs';

const SOURCE=new Set(['pncp','compras']);
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const PNCP_ID=/^\d{14}-[1-9]-\d{6}\/20\d{2}$/;
const PURCHASE_ID=/^\d{14}-1-\d{6}\/20\d{2}$/;
const CPF=/^\*\*\*\.\d{3}\.\d{3}-\*\*$/;
const CNPJ=/^\d{14}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const FIELDS=['id','source','scope','orgCnpj','publishedMonth','number',
 'pncpId','procurementId','process','unitCode','signed','starts','ends',
 'amountCents','supplierCnpj','supplierCpfMasked','supplierName','object','objectCheckedAt','kind',
 'sourceUpdatedAt','recheckedAt','lastChangedAt','revisionCount',
 'commitmentStatus','commitmentAt','commitmentRefs','commitmentAudit','commitmentDetails','commitmentContext','procurementLinkStatus','procurementLinkAt',
 'adhesion','ataControl','remanejamento'];

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
  exactKeys(data,['schema_version','unit','contracts','coverage','updated_at','pncpDelta']);
  if(data.schema_version!==1||data.unit!==CAMPUS_UG||
     !Array.isArray(data.contracts)||!Array.isArray(data.coverage))throw Error('Catálogo inválido');
  if(data.updated_at!==undefined &&
     (typeof data.updated_at!=='string'||!Number.isFinite(Date.parse(data.updated_at))))
    throw Error('Carimbo de atualização inválido');
  // Checkpoint pequeno da leitura por data de atualizacao, nao cobertura de
  // publicacao mensal nem prova de execucao financeira SIAFI.
  if(data.pncpDelta!==undefined){
    exactKeys(data.pncpDelta,['since','through','pendingPublications']);
    if(!date(data.pncpDelta.since)||!date(data.pncpDelta.through)||
       data.pncpDelta.since>data.pncpDelta.through)
      throw Error('Checkpoint PNCP incremental invalido');
    // Fila bounded de IDs PNCP PUBLICOS desconhecidos, nunca documentos CGU.
    // A pendencia so e removida quando o mesmo ID e recuperado pelo mes oficial.
    const pending=data.pncpDelta.pendingPublications;
    if(pending!==undefined){
      if(!Array.isArray(pending)||pending.length>500)
        throw Error('Fila PNCP fora do limite');
      const seenPending=new Set();
      let previous='';
      for(const item of pending){
        exactKeys(item,['id','publishedMonth']);
        const key=item.publishedMonth+'/'+item.id;
        if(typeof item.id!=='string'||!item.id.startsWith('pncp:')||
           !PNCP_ID.test(item.id.slice(5))||
           ![CAMPUS_CNPJ,REITORIA_CNPJ].includes(item.id.slice(5,19))||
           !MONTH.test(item.publishedMonth)||key<=previous||
           seenPending.has(item.id))
          throw Error('Fila PNCP com identidade ou ordem invalida');
        previous=key;
        seenPending.add(item.id);
      }
    }
  }
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
         (contract.scope==='campus' && contract.orgCnpj!==CAMPUS_CNPJ))
        throw Error('Identificação ou escopo PNCP inválidos');
    }else if(!contract.id.startsWith('compras:'+CAMPUS_UG+':')||
             contract.scope!=='campus'||contract.unitCode!==CAMPUS_UG) {
      throw Error('Identificação Compras.gov inválida');
    }
    if(['adhesion','ataControl','remanejamento'].some(k=>contract[k]!==undefined)){
      if(contract.source!=='pncp'||!contract.pncpId.startsWith(contract.orgCnpj+'-2-')||
       ['adhesion','remanejamento'].some(k=>contract[k]!==undefined&&typeof contract[k]!=='boolean')||
       (contract.ataControl!==undefined&&(!/^\d{14}-1-\d{6}\/20\d{2}-\d{6}$/.test(contract.ataControl)||
        (contract.procurementId&&contract.ataControl.slice(0,-7)!==contract.procurementId&&contract.adhesion!==true))))
       throw Error('Evidencia de adesao/ata PNCP invalida');
    }
    if(contract.commitmentStatus!==undefined){
      if(contract.source!=='pncp' ||
         !['complete','unavailable'].includes(contract.commitmentStatus) ||
         !/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(contract.commitmentAt??'')) {
        throw Error('Estado de consulta de NE do PNCP inválido');
      }
      if(contract.commitmentStatus==='complete'&& !Array.isArray(contract.commitmentRefs)) {
        throw Error('Lista de NEs obrigatória em consulta concluída');
      }
      if(contract.commitmentStatus==='unavailable'&&contract.commitmentRefs!==undefined){
        throw Error('Resposta incompleta de NE não pode ser publicada');
      }
    }else if(contract.commitmentAt!==undefined||contract.commitmentRefs!==undefined) {
      throw Error('NE sem cobertura de consulta');
    }
    if(contract.commitmentRefs!==undefined){
      if(contract.commitmentRefs.length>500 ||
         new Set(contract.commitmentRefs).size!==contract.commitmentRefs.length ||
         contract.commitmentRefs.some(ref=>typeof ref!=='string' ||
           !/^158459(?:\d{5})?20\d{2}NE\d{6}$/.test(ref))) {
        throw Error('NE oficial incompatível com a UG 158459');
      }
    }
    if(contract.commitmentAudit!==undefined||contract.commitmentDetails!==undefined){
      if(contract.commitmentStatus!=='complete')throw Error('Metadados PNCP sem consulta completa');
      validateCommitmentMetadata(contract.commitmentAudit,contract.commitmentDetails,contract.commitmentRefs);
    }
    if(contract.commitmentContext!==undefined){
      if(contract.commitmentStatus!=='complete'||!contract.commitmentAudit)throw Error('Indicios PNCP sem cobertura');
      validateContextualCommitments(contract.commitmentContext,contract);
      if(contract.commitmentContext.length>contract.commitmentAudit.formats.shortOnly+contract.commitmentAudit.formats.campusShort)
        throw Error('Indicios PNCP excedem registros abreviados');
    }
    if(contract.procurementId!==undefined&&!PURCHASE_ID.test(contract.procurementId))
      throw Error('Referência de contratação PNCP inválida');
    if(contract.procurementLinkStatus!==undefined) {
      if(contract.source!=='pncp' ||
         !['linked','not_reported','unavailable'].includes(contract.procurementLinkStatus) ||
         typeof contract.procurementLinkAt!=='string' ||
         !date(contract.procurementLinkAt)) {
        throw Error('Status de vínculo contrato-contratação inválido');
      }
      if(contract.procurementLinkStatus==='linked' && !contract.procurementId)
        throw Error('Vínculo oficial declarado sem ID da contratação');
      if(contract.procurementLinkStatus==='not_reported' && contract.procurementId)
        throw Error('Vínculo contraditório: informado e ausente');
    } else if (contract.procurementLinkAt!==undefined) {
      throw Error('Data de verificação sem estado de vínculo');
    }
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
    if(contract.object!==undefined&&publicNarrativeText(contract.object)!==contract.object)
      throw Error('Objeto contratual não sanitizado');
    if(contract.objectCheckedAt!==undefined&&!date(contract.objectCheckedAt))
      throw Error('Data de revisão narrativa contratual inválida');
    for(const field of ['sourceUpdatedAt','recheckedAt','lastChangedAt']){
      if(contract[field]!==undefined&&!date(contract[field]))
        throw Error('Data de revisao PNCP invalida');
    }
    if(contract.revisionCount!==undefined&&
       (!Number.isSafeInteger(contract.revisionCount)||contract.revisionCount<1))
      throw Error('Contagem de revisoes PNCP invalida');
    if(contract.kind!==undefined&&publicItemDescription(contract.kind,80)!==contract.kind)
      throw Error('Espécie contratual não sanitizada');
  }
  const coverageKeys=new Set();
  for(const c of data.coverage){
    exactKeys(c,['source','month','status','count','skipped','httpStatus','closedMonth']);
    if(!SOURCE.has(c.source)||!MONTH.test(c.month) ||
       !['complete','partial','unavailable'].includes(c.status)||
       (c.count!==undefined&&(!Number.isSafeInteger(c.count)||c.count<0))||
       (c.skipped!==undefined&&(!Number.isSafeInteger(c.skipped)||c.skipped<0))||
       (c.httpStatus!==undefined&&(!Number.isInteger(c.httpStatus)||c.httpStatus<0||c.httpStatus>599))||
       (c.closedMonth!==undefined&&(c.closedMonth!==true||c.status!=='complete'))||
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
    const {source,month,records,skipped=0,status='complete',httpStatus,closedMonth}=scan;
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
        const oldContracts=new Map(next.contracts.map(record=>[record.id,record]));
        next.contracts=next.contracts.filter(entry=>
          entry.source!==source||entry.publishedMonth!==month);
        for(const record of records){
          const copy=structuredClone(record);
          const old=oldContracts.get(copy.id);
          if(old?.object&&!copy.object)copy.object=old.object;
          if(old?.objectCheckedAt)copy.objectCheckedAt=old.objectCheckedAt;
          for(const field of ['recheckedAt','lastChangedAt','revisionCount']){
            if(old?.[field]!==undefined)copy[field]=old[field];
          }
          if(old?.sourceUpdatedAt&&(!copy.sourceUpdatedAt||
             old.sourceUpdatedAt>copy.sourceUpdatedAt)){
            for(const field of CONTRACT_FIELDS){
              if(old[field]!==undefined)copy[field]=old[field];
            }
            copy.sourceUpdatedAt=old.sourceUpdatedAt;
          }
          // Preservar consulta de NE apenas se os campos-base do instrumento
          // não mudaram. Contratos retificados devem ser reconsultados.
          const sameInstrument=old && old.number===copy.number &&
            old.unitCode===copy.unitCode && old.process===copy.process && old.supplierCnpj===copy.supplierCnpj && old.supplierCpfMasked===copy.supplierCpfMasked;
          if(sameInstrument && old.commitmentStatus) {
            copy.commitmentStatus=old.commitmentStatus;
            copy.commitmentAt=old.commitmentAt;
            if(old.commitmentStatus==='complete'){
              copy.commitmentRefs=structuredClone(old.commitmentRefs);
              for(const key of ['commitmentAudit','commitmentDetails','commitmentContext'])
                if(old[key]!==undefined)copy[key]=structuredClone(old[key]);
            }
          }
          // O detalhe do contrato confirma o vínculo. Uma atualização do
          // resumo não deve apagá-lo; divergência explícita exige rechecagem.
          if(sameInstrument && old.procurementId && !copy.procurementId)
            copy.procurementId=old.procurementId;
          if(sameInstrument && old.procurementLinkStatus &&
             (!copy.procurementId || copy.procurementId===old.procurementId)) {
            copy.procurementLinkStatus=old.procurementLinkStatus;
            copy.procurementLinkAt=old.procurementLinkAt;
          }
          // O resumo pode omitir os atributos da adesao; nao apagar evidencia.
          if(sameInstrument)for(const k of ['adhesion','ataControl','remanejamento']){
            if(copy[k]===undefined&&old[k]!==undefined)copy[k]=old[k];
          }
          if(copy.ataControl&&copy.procurementId&&copy.ataControl.slice(0,-7)!==copy.procurementId&&copy.adhesion!==true)delete copy.ataControl;
          next.contracts.push(copy);
        }
      }
    }
    next.coverage=next.coverage.filter(item=>item.source!==source||item.month!==month);
    next.coverage.push({source,month,status,...(status==='unavailable'?
      {httpStatus:httpStatus??0}:{count:records.length,skipped,...(status==='complete'&&(closedMonth===true||before?.closedMonth===true)?{closedMonth:true}:{})})});
  }
  next.contracts.sort((a,b)=>a.source.localeCompare(b.source)||a.id.localeCompare(b.id));
  next.coverage.sort((a,b)=>a.month.localeCompare(b.month)||a.source.localeCompare(b.source));
  validateProcurement(next);
  // Ordenação de chaves evita commits falsos após anexar campos de
  // enriquecimento em ordem distinta da publicação original.
  const sortKeys=value=>Array.isArray(value)?value.map(sortKeys):
    value&&typeof value==='object'?Object.fromEntries(
      Object.keys(value).sort().map(key=>[key,sortKeys(value[key])])):value;
  const canonical=obj=>{
    const value=structuredClone(obj);delete value.updated_at;
    return JSON.stringify(sortKeys(value));
  };
  if(canonical(next)===canonical(previous))return {changed:false,data:previous};
  next.updated_at=now.toISOString();
  return {changed:true,data:next};
}

/** Enriquecimento por contrato PNCP, com checkpoint no catálogo (sem novo JSON). */
export function applyCommitmentResult(existing,id,result,now=new Date()){
  const original=validateProcurement(structuredClone(existing));
  const contract=original.contracts.find(entry=>entry.id===id);
  if(!contract || contract.source!=='pncp')throw Error('Instrumento PNCP não encontrado');
  if(!['complete','unavailable'].includes(result?.status) ||
     (result.status==='complete'&&(!Array.isArray(result.refs) ||
       result.refs.length>500))) throw Error('Estado PNCP inválido');
  const next=structuredClone(original);
  const updated=next.contracts.find(entry=>entry.id===id);
  if(result.status==='unavailable'&&updated.commitmentStatus==='complete'){
    return {changed:false,data:original};
  }
  updated.commitmentStatus=result.status;
  if(result.status==='complete'){
    updated.commitmentRefs=[...new Set(result.refs)].sort();
    if(result.audit!==undefined||result.details!==undefined){
      validateCommitmentMetadata(result.audit,result.details,updated.commitmentRefs);
      updated.commitmentAudit=structuredClone(result.audit);
      updated.commitmentDetails=structuredClone(result.details);
      if(result.context!==undefined){
        validateContextualCommitments(result.context,updated);
        updated.commitmentContext=structuredClone(result.context);
      }else if(updated.commitmentContext!==undefined){
        // Sem nova comparacao, nao associar indicios a uma nova resposta.
        delete updated.commitmentContext;
      }
    }else if(updated.commitmentAudit!==undefined){
      // Legacy caller cannot replace audited references with a narrower payload.
      if(JSON.stringify(contract.commitmentRefs)!==JSON.stringify(updated.commitmentRefs))
        throw Error('Reconsulta legada nao pode modificar evidencia detalhada');
    }
  }else{
    delete updated.commitmentRefs;
    delete updated.commitmentAudit;
    delete updated.commitmentDetails;
    delete updated.commitmentContext;
  }
  const before=structuredClone(original);
  const after=structuredClone(next);
  const previousContract=before.contracts.find(entry=>entry.id===id);
  const proposed=after.contracts.find(entry=>entry.id===id);
  delete previousContract.commitmentAt;
  delete proposed.commitmentAt;
  if(JSON.stringify(previousContract)===JSON.stringify(proposed)){
    return {changed:false,data:original};
  }
  updated.commitmentAt=now.toISOString().slice(0,10);
  next.updated_at=now.toISOString();
  validateProcurement(next);
  return {changed:true,data:next};
}
export async function writeCommitmentResult(root,id,result,now=new Date()){
  const filename=join(root,'data','procurement','contracts.json');
  const previous=await readProcurement(root);
  if(!previous)throw Error('Catálogo PNCP indisponível');
  const outcome=applyCommitmentResult(previous,id,result,now);
  if(!outcome.changed)return outcome;
  const tmp=filename+'.tmp';
  try{
    await writeFile(tmp,JSON.stringify(outcome.data)+'\n','utf8');
    await rename(tmp,filename);
  }catch(error){await unlink(tmp).catch(()=>{});throw error}
  return outcome;
}

/** Atualiza somente o vínculo contratual comprovado pelo ID PNCP. */
export function applyContractPurchaseLink(current,id,result,now=new Date()) {
  const original=validateProcurement(structuredClone(current));
  const contract=original.contracts.find(c=>c.id===id);
  if(!contract || contract.source!=='pncp')throw Error('Contrato PNCP não encontrado');
  if(!result||!['linked','not_reported','unavailable'].includes(result.status))
    throw Error('Estado do vínculo PNCP não reconhecido');
  if(result.status==='linked' &&
     (typeof result.procurementId!=='string'||!PURCHASE_ID.test(result.procurementId))) {
    throw Error('ID oficial de contratação inválido');
  }
  // Falha ou campo ausente não derrubam vínculo oficial previamente obtido.
  if(result.status!=='linked' && contract.procurementId) {
    return {changed:false,data:original};
  }
  if(result.status==='unavailable'&&contract.procurementLinkStatus==='not_reported'){
    return {changed:false,data:original};
  }
  const next=structuredClone(original);
  const target=next.contracts.find(c=>c.id===id);
  target.procurementLinkStatus=result.status;
  target.procurementLinkAt=now.toISOString().slice(0,10);
  if(result.status==='linked')target.procurementId=result.procurementId;
  else delete target.procurementId;
  validateProcurement(next);
  if(JSON.stringify(target)===JSON.stringify(contract))return {changed:false,data:original};
  next.updated_at=now.toISOString();
  return {changed:true,data:next};
}
export async function writeContractPurchaseLink(root,id,result,now=new Date()){
  const filename=join(root,'data','procurement','contracts.json');
  const previous=await readProcurement(root);
  if(!previous)throw Error('Catálogo contratual não disponível');
  const outcome=applyContractPurchaseLink(previous,id,result,now);
  if(!outcome.changed)return outcome;
  const tmp=filename+'.tmp';
  try{
    await writeFile(tmp,JSON.stringify(outcome.data)+'\n','utf8');
    await rename(tmp,filename);
  }catch(error){await unlink(tmp).catch(()=>{});throw error}
  return outcome;
}

/** Inclui instrumento individual comprovado, sem alegar cobertura integral.
 * Preserva todos os demais registros e reabre a competencia se necessario. */
export function applyDirectInstrument(existing,record,now=new Date()){
 const original=validateProcurement(structuredClone(existing||blankProcurement()));
 if(record?.source!=='pncp'||!/^\d{14}-2-\d{6}\/20\d{2}$/.test(record.pncpId||'')||
   record.id!=='pncp:'+record.pncpId||!record.pncpId.startsWith(record.orgCnpj+'-2-')||
   record.publishedMonth<'2024-01'||Number(record.pncpId.slice(-4))<2024)
  throw Error('Instrumento individual fora do escopo');
 if(original.contracts.some(c=>c.id===record.id))return {changed:false,data:original};
 const next=structuredClone(original);
 next.contracts.push(structuredClone(record));next.contracts.sort((a,b)=>a.id.localeCompare(b.id));
 const previous=next.coverage.find(c=>c.source==='pncp'&&c.month===record.publishedMonth);
 next.coverage=next.coverage.filter(c=>!(c.source==='pncp'&&c.month===record.publishedMonth));
 next.coverage.push({source:'pncp',month:record.publishedMonth,status:'partial',
  count:next.contracts.filter(c=>c.source==='pncp'&&c.publishedMonth===record.publishedMonth).length,skipped:previous?.skipped||0});
 next.coverage.sort((a,b)=>a.month.localeCompare(b.month)||a.source.localeCompare(b.source));
 next.updated_at=now.toISOString();validateProcurement(next);return {changed:true,data:next};
}
export async function writeDirectInstrument(root,record,now=new Date()){
 const dir=join(root,'data','procurement'),path=join(dir,'contracts.json'),tmp=path+'.tmp';
 const result=applyDirectInstrument(await readProcurement(root),record,now);
 if(!result.changed)return result;
 await mkdir(dir,{recursive:true});
 try{await writeFile(tmp,JSON.stringify(result.data)+'\n','utf8');await rename(tmp,path)}
 catch(e){await unlink(tmp).catch(()=>{});throw e}
 return result;
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

/**
 * Alteracoes materiais posteriores a publicacao: aplica apenas campos oficiais
 * normalizados e presentes, sem inferir remocao por null ou resposta incompleta.
 * O Git preserva o historico; o JSON guarda somente o estado atual e metadados.
 */
export const NOTICE_FIELDS=Object.freeze([
  'number','process','unitCode','object','estimatedCents','homologatedCents',
  'situation','srp','disputeMode','legalBasisCode','proposalStart','proposalEnd'
]);
export const CONTRACT_FIELDS=Object.freeze([
  'number','process','unitCode','signed','starts','ends','amountCents','object','kind',
  'supplierCnpj','supplierCpfMasked','supplierName','procurementId','adhesion','ataControl','remanejamento'
]);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function assertSource(record,update,kind){
  if(!record||!update||record.id!==update.id||record.pncpId!==update.pncpId||
     record.source!=='pncp'||update.source!=='pncp')
    throw Error('Identidade oficial PNCP divergente');
  if(kind==='notice'){
    if(record.month!==update.month||record.modality!==update.modality||
       record.published!==update.published||
       record.publicationUasg!==update.publicationUasg)
      throw Error('Periodo/modalidade PNCP divergente; revisar cobertura');
  }else if(kind==='contract'){
    if(record.publishedMonth!==update.publishedMonth||
       record.scope!==update.scope||record.orgCnpj!==update.orgCnpj)
      throw Error('Periodo/publicador PNCP divergente; revisar cobertura');
  }else throw Error('Tipo de revisao PNCP invalido');
}
function dateString(now){
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw Error('Data de revisao invalida');
  return now.toISOString().slice(0,10);
}

/** Conta alteracoes observadas NO OBSERVATORIO, nao numero oficial de retificacoes. */
export function mergePncpRecord(original,incoming,{kind,now=new Date(),checked=false}={}){
  assertSource(original,incoming,kind);
  const today=dateString(now);
  if(original.sourceUpdatedAt&&incoming.sourceUpdatedAt&&
     incoming.sourceUpdatedAt<original.sourceUpdatedAt)
    return {record:structuredClone(original),changed:false,materialChanged:false,stale:true};
  const record=structuredClone(original);
  const fields=kind==='notice'?NOTICE_FIELDS:CONTRACT_FIELDS;
  const before={...record};
  for(const key of fields){
    // null/ausencia: desconhecido no payload, nao prova exclusao do campo oficial.
    if(incoming[key]!==undefined && incoming[key]!==null)
      record[key]=structuredClone(incoming[key]);
  }
  if(kind==='contract'){
    const supplierIdentityChanged=
      (incoming.supplierCnpj&&incoming.supplierCnpj!==original.supplierCnpj)||
      (incoming.supplierCpfMasked&&incoming.supplierCpfMasked!==original.supplierCpfMasked);
    if(incoming.supplierCnpj){
      delete record.supplierCpfMasked;
      if(supplierIdentityChanged && !incoming.supplierName)delete record.supplierName;
    }else if(incoming.supplierCpfMasked){
      delete record.supplierCnpj;
      delete record.supplierName;
    }
    if(record.ataControl&&record.procurementId&&record.ataControl.slice(0,-7)!==record.procurementId)delete record.ataControl;
    const linkChanged=record.procurementId!==original.procurementId;
    if(linkChanged&&record.procurementId){
      record.procurementLinkStatus='linked';
      record.procurementLinkAt=today;
    }
    // Referencias de NE da coleta anterior nao podem permanecer confirmadas
    // apos uma mudanca de identificadores de instrumento/fornecedor.
    if(['number','process','unitCode','supplierCnpj','supplierCpfMasked','procurementId']
      .some(key=>!same(before[key],record[key]))){
      delete record.commitmentStatus;
      delete record.commitmentRefs;
      delete record.commitmentAudit;
      delete record.commitmentDetails;
      delete record.commitmentContext;
      delete record.commitmentAt;
    }
  }
  const materialChanged=fields.some(key=>!same(before[key],record[key]));
  if(incoming.sourceUpdatedAt &&
     (!record.sourceUpdatedAt ||incoming.sourceUpdatedAt>record.sourceUpdatedAt))
    record.sourceUpdatedAt=incoming.sourceUpdatedAt;
  if(materialChanged){
    record.revisionCount=(record.revisionCount||0)+1;
    record.lastChangedAt=today;
  }
  if(checked)record.recheckedAt=today;
  return {
    record,materialChanged,
    changed:!same(record,original),stale:false
  };
}

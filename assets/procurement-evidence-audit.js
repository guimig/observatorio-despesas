import {extractAraquariNeEvidence,matchDocumentContract} from './procurement-links.js';
/** Auditoria de referencias de NE sem afirmar inexistencia de despesa. */
export function auditProcurementReferences(contracts=[],documents=[],{loadedMonths=0,totalMonths=0}={}){
 const complete=totalMonths>0&&loadedMonths===totalMonths;
 const known=new Map();
 for(const doc of documents){
  if(doc?.phase===1&&typeof doc.id==='string'&&/^158459\d{5}20\d{2}NE\d{6}$/.test(doc.id))
   known.set(doc.id,doc);
 }
 const findings=[],seen=new Set();
 for(const contract of contracts){
  const instrument=String(contract?.id||contract?.pncpId||contract?.number||'');
  if(!instrument)continue;
  const refs=Array.isArray(contract.commitmentRefs)?[...contract.commitmentRefs]:[];
  // O PNCP tambem pode registrar a NE como numero do instrumento.
  // Sem UG explicitamente associada, numero curto nao e prova suficiente.
  if(typeof contract.number==='string'&&
     (extractAraquariNeEvidence(contract.number)||
      String(contract.unitCode??'')==='158459'&&/^20\d{2}NE\d{6}$/.test(contract.number))) {
    refs.push(contract.number);
  }
  for(const ref of refs){
   const parsed=extractAraquariNeEvidence(ref);
   const shortByUnit=!parsed&&ref===contract.number&&String(contract.unitCode??'')==='158459'&&
     /^20\d{2}NE\d{6}$/.test(ref)?{kind:'ug_short',short:ref}:null;
   const evidence=parsed||shortByUnit;
   if(!evidence)continue;
   const reference=evidence.kind==='full'?evidence.ne:evidence.short;
   const key=instrument+'|'+reference;
   if(seen.has(key))continue;seen.add(key);
   const matched=[...known.values()].some(doc=>
     evidence.kind==='full'?doc.id===reference&&matchDocumentContract(doc,contract)?.level==='confirmed':
     doc.id.endsWith(reference));
   findings.push({instrument,reference,procurementId:contract.procurementId||null,
    status:matched?(evidence.kind==='full'?'verified':'indication_only'):complete?'not_found_in_published_history':'not_checked_fully'});
  }
 }
 const counts={verified:0,indication_only:0,not_found_in_published_history:0,not_checked_fully:0};
 for(const row of findings)counts[row.status]++;
 return {complete,loadedMonths,totalMonths,counts,findings};
}

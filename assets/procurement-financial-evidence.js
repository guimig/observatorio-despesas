/** Evidencias documentais da relacao licitacao -> instrumento -> NE do campus.
 * Nunca deduz NE a partir de ARP, objeto, fornecedor ou valor estimado.
 */
import {assessContractAttribution,matchDocumentContract} from './procurement-links.js';
export function procurementFinancialEvidence(notice,contracts=[],documents=[]){
 const linked=contracts.filter(c=>c.procurementId===notice?.pncpId);
 const confirmed=new Set(),indications=new Set();
 for(const contract of linked){
  const attribution=assessContractAttribution(contract,documents);
  if(attribution.level==='confirmed')confirmed.add(contract.id||contract.pncpId);
  else if(attribution.level!=='unverified')indications.add(contract.id||contract.pncpId);
 }
 // Processos administrativos coincidentes, isoladamente, nao confirmam NE.
 const verifiedNes=new Set();
 for(const doc of documents){
  if(doc?.phase!==1||typeof doc.id!=='string'||!/^158459\d{5}20\d{2}NE\d{6}$/.test(doc.id))continue;
  if(linked.some(c=>matchDocumentContract(doc,c)?.level==='confirmed'))verifiedNes.add(doc.id);
 }
 return {instruments:linked.length,confirmedInstruments:confirmed.size,
  indicatedInstruments:indications.size,verifiedCommitments:verifiedNes.size,
  level:verifiedNes.size?'confirmed':confirmed.size?'confirmed':
    indications.size?'indication':'unverified'};
}

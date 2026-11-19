/**
 * Identificação de Araquari independente da UG publicadora do PNCP.
 *
 * Reitoria: UASG 158125 (publicadora centralizada).
 * Campus Araquari: UG SIAFI 158459 (execução).
 * Processo SIPAC Araquari: prefixo 23349 (indício secundário, digitado manualmente).
 *
 * "confirmed" é permitido apenas quando uma NE oficial é confrontada com
 * documento CGU da mesma UG, ou quando o PNCP fornece NE completa dessa UG
 * explicitamente vinculada ao contrato.
 */
export const ARAQUARI_UG='158459';
const NE_FULL=/^158459\d{5}(20\d{2}NE\d{6})$/;
const NE_SHORT=/^20\d{2}NE\d{6}$/;
const NE_WITH_UG=/^158459[- /]?(20\d{2}NE\d{6})$/;
const PROC=/^\d{5}\.\d{6}\/20\d{2}-\d{2}$/;
const PROC_ARAQUARI=/^23349\.\d{6}\/20\d{2}-\d{2}$/;

function normalizeNumber(text) {
  return typeof text==='string' ? text.toUpperCase().replace(/[\s]+/g,'') : '';
}
function verifiedFullNe(input) {
  const number=normalizeNumber(input);
  return NE_FULL.test(number) ? number : null;
}
export function isAraquariProcess(value){
  return typeof value==='string' && PROC_ARAQUARI.test(value.trim());
}
export function extractAraquariNeEvidence(raw) {
  const number=normalizeNumber(raw);
  const full=verifiedFullNe(number);
  if(full)return {kind:'full',ne:full};
  const matched=NE_WITH_UG.exec(number);
  if(matched)return {kind:'ug_short',short:matched[1]};
  return null;
}
export function matchesFullNe(document,number) {
  return !!document && document.phase===1 &&
    typeof document.id==='string' && NE_FULL.test(document.id) &&
    document.id===verifiedFullNe(number);
}
function contractNeNumbers(contract) {
  return Array.isArray(contract?.commitmentRefs) ? contract.commitmentRefs : [];
}

/**
 * Níveis: confirmed (NE + UG oficial); context (mesmo processo + CNPJ),
 * process (mesmo processo); null (não há elo documental).
 *
 * O número do contrato/NE publicado centralmente não implica UG 158459.
 * Apenas a combinação unidade 158459 + número curto da NE + documento CGU
 * permite confirmação quando não há a NE completa.
 */
export function matchDocumentContract(document, contract) {
  if(!document || !contract)return null;
  const id=String(document.id??'');

  if(document.phase===1 && NE_FULL.test(id)) {
    if(contractNeNumbers(contract).some(ref=>matchesFullNe(document,ref)) ||
       matchesFullNe(document,contract.number)) {
      return {level:'confirmed',reason:'NE integral da UG 158459 vinculada ao contrato'};
    }
    const short=id.slice(-12);
    const number=normalizeNumber(contract.number);
    if(String(contract.unitCode??'')===ARAQUARI_UG && number===short) {
      return {level:'confirmed',reason:'Unidade 158459 e número de NE coincidem com documento CGU'};
    }
    if(contractNeNumbers(contract).some(ref=>{
      const parsed=extractAraquariNeEvidence(ref);
      return parsed?.kind==='ug_short' && parsed.short===short;
    })) {
      return {level:'confirmed',reason:'UG e número da NE vinculada coincidem com documento CGU'};
    }
  }

  const proc=typeof document.process==='string'?document.process:'';
  if(PROC.test(proc) && proc===contract.process) {
    const sameSupplier=document.partyRef &&
      contract.supplierCnpj && document.partyRef===contract.supplierCnpj;
    if(sameSupplier) {
      return {level:'context',reason:'Processo e CNPJ do fornecedor coincidentes'};
    }
    return {level:'process',reason:'Mesmo processo administrativo; sujeito a digitação manual'};
  }
  return null;
}

/**
 * Resumo do filtro Araquari: nunca classificar a UG publicadora 158125
 * como prova de pertencimento ou exclusão de algum campus.
 * Contratos centralizados excepcionais podem não ter processo 23349.
 */
export function assessContractAttribution(contract, documents = []) {
  const refs=contractNeNumbers(contract);
  if(refs.some(ref=>extractAraquariNeEvidence(ref)?.kind==='full')) {
    return {level:'confirmed',reason:'PNCP declara NE completa da UG 158459'};
  }
  const matches=documents.map(doc=>matchDocumentContract(doc,contract)).filter(Boolean);
  if(matches.some(m=>m.level==='confirmed')) {
    return {level:'confirmed',reason:'Empenho identificado simultaneamente no PNCP e na CGU'};
  }
  if(refs.some(ref=>extractAraquariNeEvidence(ref)?.kind==='ug_short')) {
    return {level:'ne_indication',reason:'PNCP registra UG 158459 e número de NE sem gestão'};
  }
  if(String(contract?.unitCode??'')===ARAQUARI_UG &&
     NE_SHORT.test(normalizeNumber(contract?.number))) {
    return {level:'ne_indication',reason:'Unidade 158459 + número curto da NE no PNCP (sem validação CGU)'};
  }
  if(matches.some(m=>m.level==='context')) {
    return {level:'context',reason:'Processo e CNPJ coincidentes com documento da UG'};
  }
  if(isAraquariProcess(contract?.process)) {
    return {level:'process_indication',reason:'Processo 23349: indício secundário, digitado manualmente'};
  }
  return {level:'unverified',reason:'Sem NE vinculada ou processo que identifique a UG 158459'};
}


/** Uma licitação PNCP centralizada não é do campus por constar UG publicadora.
 * A atribuição é confirmada apenas quando um contrato da própria contratação
 * tem NE comprovada da UG 158459.
 */
export function assessNoticeAttribution(notice,contracts=[],documents=[]) {
  if(!notice)return {level:'unverified',reason:'Contratação sem identificador PNCP'};
  const related=contracts.filter(contract=>contract.procurementId &&
    contract.procurementId===notice.pncpId);
  if(related.some(contract=>
    assessContractAttribution(contract,documents).level==='confirmed')) {
    return {level:'confirmed',reason:'Contratação ligada a contrato com NE confirmada da UG 158459'};
  }
  if(isAraquariProcess(notice.process)) {
    return {level:'process_indication',reason:'Processo SIPAC 23349: origem provável, digitada manualmente'};
  }
  if(related.some(contract=>
    assessContractAttribution(contract,documents).level!=='unverified')) {
    return {level:'context',reason:'Contratação relacionada a contrato com indícios de Araquari'};
  }
  return {level:'unverified',reason:'Edital publicado pela Reitoria, campus beneficiário não identificado'};
}

/**
 * O PNCP possui a coleção "Contratos/Empenhos", não apenas termos de contrato.
 * Não derivar natureza jurídica pelo número PNCP, CNPJ publicador, processo ou
 * pelo fato de o documento aparecer no endpoint /contratos.
 *
 * Falha fechada: instrumento sem tipo reconhecido NÃO entra na tabela de
 * contratos em sentido estrito; permanece no catálogo para revisão.
 */
export function classifyPncpInstrument(record) {
  if (!record || typeof record!=='object') return 'unclassified';
  const type=typeof record.kind==='string'?
    record.kind.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase():'';
  if (['contrato (termo inicial)','contrato','termo de contrato'].includes(type)) {
    return 'formal_contract';
  }
  if (['empenho','nota de empenho','nota de empenho substitutiva'].includes(type)) {
    return 'commitment_substitute';
  }
  if (['carta-contrato','autorizacao de compra',
    'ordem de execucao de servico','ordem de fornecimento'].includes(type)) {
    return 'other_substitute';
  }
  return 'unclassified';
}
export function isFormalContract(record) {
  return classifyPncpInstrument(record)==='formal_contract';
}
export function groupPublishedInstruments(items,noticeId) {
  const result={formal:[],commitments:[],other:[],unclassified:[]};
  for(const entry of items||[]) {
    if(entry.procurementId!==noticeId)continue;
    const type=classifyPncpInstrument(entry);
    if(type==='formal_contract')result.formal.push(entry);
    else if(type==='commitment_substitute')result.commitments.push(entry);
    else if(type==='other_substitute')result.other.push(entry);
    else result.unclassified.push(entry);
  }
  return result;
}
export function summarizeInstrumentTypes(records) {
  const summary={formal:0,commitments:0,other:0,unclassified:0};
  for(const row of records||[]) {
    const category=classifyPncpInstrument(row);
    if(category==='formal_contract')summary.formal++;
    else if(category==='commitment_substitute')summary.commitments++;
    else if(category==='other_substitute')summary.other++;
    else summary.unclassified++;
  }
  return summary;
}

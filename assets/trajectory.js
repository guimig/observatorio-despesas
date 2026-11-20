/** Índice de trajetória documental por nota de empenho (NE). */
const NE_ID = /^158459\d{5}20\d{2}NE\d{6}$/;

export function buildCommitmentTrajectories(months) {
  if (!Array.isArray(months)) throw new Error('Acervo mensal inválido');
  const documents = new Map();
  const commitments = new Map();
  const relations = new Map();
  const issues = [];

  for (const month of months) {
    if (!month || month.unit !== '158459' || !Array.isArray(month.documents) ||
        !Array.isArray(month.relations)) {
      throw new Error('Competência incompatível com a trajetória da UG 158459');
    }
    for (const doc of month.documents) {
      if (typeof doc.id !== 'string') continue;
      if (documents.has(doc.id)) {
        const prior=documents.get(doc.id);
        if (prior.phase !== doc.phase || prior.cents !== doc.cents) issues.push({type:'document_conflict',id:doc.id});
      }
      documents.set(doc.id, { ...doc, month: month.month });
      if (doc.phase === 1 && NE_ID.test(doc.id)) {
        commitments.set(doc.id, commitments.get(doc.id) || {
          id: doc.id, document: { ...doc, month: month.month }, links: [], items: null,
          itemsChecked: false
        });
      }
    }
  }

  for (const month of months) {
    for (const relation of month.relations) {
      if (!NE_ID.test(relation.to || '') || !Number.isSafeInteger(relation.cents)) continue;
      const source = documents.get(relation.from);
      const phase = source?.phase ?? (/NS\d{6}$/.test(relation.from) ? 2 :
        /(?:OB|DF|DR|GP)\d{6}$/.test(relation.from) ? 3 : null);
      if (![2, 3].includes(phase)) continue;
      const key = relation.from + '>' + relation.to;
      if (relations.has(key)) {
        if (relations.get(key) !== relation.cents) issues.push({type:'relation_conflict',id:key});
        continue;
      }
      relations.set(key,relation.cents);
      if (!commitments.has(relation.to)) {
        commitments.set(relation.to, {
          id: relation.to, document: null, links: [], items: null, itemsChecked: false
        });
      }
      commitments.get(relation.to).links.push({
        id: relation.from, phase, date: source?.date || null,
        month: source?.month || month.month, cents: relation.cents,
        checked: source ? (phase === 2
          ? source.liquidationLinksChecked === true
          : source.paymentLinksChecked === true) : null,
        document: source || null
      });
    }
  }

  for (const month of months) {
    for (const [id, items] of Object.entries(month.itemsByDocument || {})) {
      if (!NE_ID.test(id)) continue;
      if (!commitments.has(id)) commitments.set(id, {
        id, document: documents.get(id) || null, links: [], items: null, itemsChecked: false
      });
      const entry = commitments.get(id);
      entry.items = items;
      entry.itemsChecked = true;
    }
  }

  return [...commitments.values()].map(entry => {
    const liquidations = entry.links.filter(link => link.phase === 2);
    const payments = entry.links.filter(link => link.phase === 3);
    const sum = list => list.reduce((total, link) => total + link.cents, 0);
    return {
      ...entry,
      hasCollectedCommitment: Boolean(entry.document),
      hasUnresolvedSources: entry.links.some(link => !link.document),
      completeness: !entry.document ? 'empenho_nao_coletado' :
        entry.links.some(link => !link.document) ? 'origem_nao_coletada' :
        'documentos_disponiveis',
      issues: issues.filter(issue => issue.id === entry.id || issue.id.endsWith('>'+entry.id)),
      liquidations,
      payments,
      liquidationCents: sum(liquidations),
      paymentCents: sum(payments),
      liquidationDocuments: new Set(liquidations.map(link => link.id)).size,
      paymentDocuments: new Set(payments.map(link => link.id)).size,
      multipleLiquidations: new Set(liquidations.map(link => link.id)).size > 1,
      multiplePayments: new Set(payments.map(link => link.id)).size > 1,
      sourceMonth: entry.document?.month || null,
      pendingLiquidations: liquidations.some(link => link.checked === false),
      pendingPayments: payments.some(link => link.checked === false)
    };
  }).sort((a, b) => (b.document?.date || '').localeCompare(a.document?.date || '') ||
    a.id.localeCompare(b.id));
}

export function filterCommitmentTrajectories(entries, query = '') {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter(entry => [
    entry.id, entry.document?.process, entry.document?.partyRef,
    entry.document?.nature?.element, entry.document?.nature?.group,
    entry.document?.nature?.action, entry.document?.nature?.program
  ].filter(Boolean).join(' ').toLowerCase().includes(needle));
}

/**
 * Diagnóstico de qualidade do acervo publicado. Os vínculos não representam
 * conciliação contábil nem permitem inferir quitação de uma NS por OB/DF.
 */
export function auditCommitmentTrajectories(months) {
  const entries=buildCommitmentTrajectories(months);
  const documents=new Map(months.flatMap(month=>month.documents.map(doc=>[doc.id,doc])));
  const relations=months.flatMap(month=>month.relations);
  const counts={
    months:months.length,documents:documents.size,relations:relations.length,
    commitments:entries.length,commitmentDocuments:entries.filter(e=>e.document).length,
    commitmentsWithoutDocument:entries.filter(e=>!e.document).length,
    olderYearReferences:entries.filter(e=>!e.document &&
      e.id.slice(11,15)<Math.max(...months.map(m=>Number(m.month.slice(0,4)))).toString()).length,
    missingRelationSources:relations.filter(r=>!documents.has(r.from)).length,
    multipleLiquidations:entries.filter(e=>e.multipleLiquidations).length,
    multiplePayments:entries.filter(e=>e.multiplePayments).length,
    negativeRelations:relations.filter(r=>r.cents<0).length,
    duplicateRelations:0,conflictingRelations:0,conflictingDocuments:0
  };
  const seenRelations=new Map(),seenDocuments=new Map();
  for(const month of months){
    for(const doc of month.documents){
      const prior=seenDocuments.get(doc.id);
      if(prior && (prior.phase!==doc.phase||prior.cents!==doc.cents))counts.conflictingDocuments++;
      seenDocuments.set(doc.id,doc);
    }
    for(const relation of month.relations){
      const key=relation.from+'>'+relation.to;
      if(seenRelations.has(key)){
        counts.duplicateRelations++;
        if(seenRelations.get(key)!==relation.cents)counts.conflictingRelations++;
      }
      seenRelations.set(key,relation.cents);
    }
  }
  return counts;
}

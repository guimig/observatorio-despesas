import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commitmentValueEvidence,summarizeCommitmentValues,buildCommitmentChronology,commitmentChronologyEvidence}
 from '../assets/siafi-movement-reconciliation.js';
import {buildIntegratedIndex,cguContractExecutionEvidence,summarizeIntegratedCoverage} from '../assets/integrated-trajectory.js';
import {buildCoverageIndex} from '../src/coverage-index.mjs';

const today='2026-11-27',now=new Date('2026-11-27T17:00:00Z');
const id=n=>'158459000012025NE'+String(n).padStart(6,'0');
const doc=(n,cents=100)=>({id:id(n),phase:1,date:'2025-02-10',cents,itemsDetailVersion:2});
const item=(extra={})=>({seq:1,cents:140,historyChecked:true,historyCheckedAt:'2026-11-26',
 movements:[{type:'original',date:'2025-02-01',cents:100},
 {type:'reinforcement',date:'2025-02-02',cents:70},
 {type:'annulment',date:'2025-03-01',cents:20},
 {type:'cancellation',date:'2026-02-01',cents:10}],...extra});
const month=(docs,itemsByDocument,commitmentObservations=[])=>({unit:'158459',month:'2025-02',documents:docs,relations:[],coverage:[],itemsByDocument,commitmentObservations});

test('NE com valor documental inicial distinto do atualizado preserva ambas grandezas sem alterar subtotal',()=>{
 const d=doc(1),items=[item()],m=month([d],{[d.id]:items}),before=JSON.stringify(m);
 const v=commitmentValueEvidence(d,items,[],{today});
 assert.equal(v.documentCents,100);assert.equal(v.referenceCents,100);assert.equal(v.catalogCents,140);
 assert.equal(v.initialCents,100);assert.equal(v.updatedCents,140);
 assert.equal(v.issueYearNetCents,150);assert.equal(v.netBeforeCancellationsCents,150);
 assert.equal(v.itemsStatus,'internally_reconciled');assert.equal(v.comparison,'different');
 assert.equal(v.meaning,'initial');assert.equal(v.chronologyStatus,'divergent');
 assert.equal(v.originalDate,'2025-02-01');assert.equal(v.lastMovementDate,'2026-02-01');
 assert.equal(commitmentChronologyEvidence(d,items).reason,'catalog_amount_mismatch');
 const flow=buildCommitmentChronology([m],{today});
 assert.equal(flow.reconciled,0);assert.deepEqual(flow.periods,{});
 assert.equal(JSON.stringify(m),before);
});
test('documento ausente nao impede reconstrucoes independentes mas nao cria valor documental',()=>{
 const v=commitmentValueEvidence(doc(1,null),[item()],[],{today});
 assert.equal(v.documentCents,null);assert.equal(v.referenceCents,null);assert.equal(v.updatedCents,140);
 assert.equal(v.comparison,'document_unavailable');assert.equal(v.chronologyReason,'reference_amount_pending');
});
test('zero legitimo permanece distinto de valor indisponivel',()=>{
 const zero=item({cents:0,movements:[{type:'original',date:'2025-02-01',cents:100},{type:'annulment',date:'2025-02-02',cents:100}]});
 const v=commitmentValueEvidence(doc(1,0),[zero],[],{today});
 assert.equal(v.updatedCents,0);assert.equal(v.referenceCents,0);assert.equal(v.comparison,'matching');
 assert.equal(v.initialCents,100);
});
test('ultima referencia documental distinta da origem exige checkpoint atualizado',()=>{
 const d=doc(1),observation={id:d.id,date:'2026-11-25',ownerDate:d.date,cents:140};
 const v=commitmentValueEvidence(d,[item()],[observation],{today});
 assert.equal(v.documentCents,100);assert.equal(v.referenceCents,140);
 assert.equal(v.referenceDate,'2026-11-25');assert.equal(v.comparison,'matching');
 const stale=commitmentValueEvidence(d,[item({historyCheckedAt:'2026-11-24'})],[observation],{today});
 assert.equal(stale.itemsStatus,'history_older_than_listing');assert.equal(stale.updatedCents,null);
 assert.equal(stale.catalogCents,140);
});
test('reconstrucao nao utiliza sequenciais duplicados, catalogos legados, historias ambiguas ou futuras',()=>{
 const d=doc(1);
 for(const [document,items,status,opts] of [
  [d,[item(),item()],'invalid_catalog',{}],
  [d,[item({historyChecked:false})],'partial',{}],
  [d,[item({cents:141})],'history_unreconciled',{}],
  [d,[item({movements:[...item().movements,{type:'other',date:'2026-03-01',cents:0}]})],'history_unreconciled',{}],
  [d,[item({movements:[...item().movements,{type:'reinforcement',date:'2027-01-01',cents:0}]})],'outside_window',{}],
  [{...d,itemsDetailVersion:undefined},[item()],'items_not_collected',{}],
  [d,[item()],'duplicate_identity',{uniqueIdentity:false}]
 ]){
  const v=commitmentValueEvidence(document,items,[],{today,...opts});
  assert.equal(v.itemsStatus,status);assert.equal(v.initialCents,null);assert.equal(v.updatedCents,null);
  assert.equal(v.comparison,'not_comparable');
 }
});
test('contagem de cobertura nao duplica identidades nem agrega valores reconstruidos',()=>{
 const docs=[doc(1),doc(2,140),doc(3,null),doc(4),doc(5)];
 const m=month(docs,{[id(1)]:[item()],[id(2)]:[item()],[id(3)]:[item()],[id(5)]:[item()]});
 const second=month([doc(5)],{[id(5)]:[item()]});
 const v=summarizeCommitmentValues([m,second],{today});
 assert.equal(v.identities,5);assert.equal(v.internal,3);assert.equal(v.documentMatching,1);
 assert.equal(v.documentDifferent,1);assert.equal(v.documentUnavailable,1);assert.equal(v.notReady,2);
 assert.equal(v.reasons.duplicate_identity,1);assert.equal(v.reasons.items_not_collected,1);
 assert.equal(v.byYear[0].internal,3);
 assert.ok(!JSON.stringify(v).includes(id(1)));assert.ok(!JSON.stringify(v).includes('updatedCents'));
});
test('trajetoria de contrato exibe reconstrucoes divergentes sem somar movimentos nem alterar impactos',()=>{
 const d=doc(1),ob='158459000012026OB000001';
 const m=month([d],{[d.id]:[item()]});
 const payments={unit:'158459',month:'2026-03',documents:[{id:ob,phase:3,date:'2026-03-01',cents:999,paymentLinksChecked:true}],relations:[{from:ob,to:d.id,cents:40}],coverage:[]};
 const index=buildIntegratedIndex({months:[m,payments],cguContracts:[{id:42,unitCode:'158459',reference:'2025-02-01',refs:[d.id]}],today});
 const e=cguContractExecutionEvidence(index,42);
 assert.equal(e.eligible,1);assert.equal(e.reconciled,0);assert.equal(e.itemValueCoverage.internal,1);assert.equal(e.itemValueCoverage.different,1);
 assert.equal(e.rows[0].values.updatedCents,140);assert.equal(e.rows[0].values.referenceCents,100);
 assert.equal(e.movements.reconstructedCents.known,0);assert.equal(e.movements.reconstructedCents.unknown,1);
 assert.equal(e.payment.cents,40);assert.equal(e.payment.known,1);
 assert.equal(e.periods.some(p=>p.initialCents.known>0),false);
 const coverage=summarizeIntegratedCoverage(index);
 assert.equal(coverage.cguContractInternalItemNe,1);assert.equal(coverage.cguContractDifferentItemNe,1);
});
test('indice de publicacao separa a nova cobertura das contagens de fluxo',()=>{
 const d=doc(1),m=month([d],{[d.id]:[item()]});
 const index=buildCoverageIndex({months:[m],now});
 assert.equal(index.commitmentValues.internal,1);assert.equal(index.commitmentValues.documentDifferent,1);
 assert.equal(index.commitmentChronology.reconciled,0);assert.deepEqual(index.commitmentChronology.periods,{});
});

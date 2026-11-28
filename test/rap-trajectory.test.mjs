import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRapTrajectories,matchesRapTrajectory,qualifiedRapInscription,summarizeRapReadiness} from '../assets/rap-trajectory.js';
const ne='158459264222024NE000001',ne2='158459264222025NE000001',ob='158459264222026OB000001',ns='158459264222026NS000001';
const e={date:'2025-01-11',operation:'INSCRICAO EM RP',quantity:'1',unitPrice:'50',cents:5000,type:'other'};
const c={rowCount:1,repeatedRows:0,liquidatedCents:0,paidCents:0,rpInscribedCents:0,rpCancelledCents:0,rpPaidCents:5000};
const m=(month,documents=[],relations=[],itemsByDocument={})=>({month,unit:'158459',documents,relations,itemsByDocument});
const owner={id:ne,phase:1,itemsDetailVersion:2,date:'2024-12-31'};
const payment={id:ob,phase:3,date:'2026-01-02',paymentLinksChecked:true};
const link={from:ob,to:ne,cents:5000,impactComponents:c};
test('agrupa inscrições por item e ocorrência sem somar valores ou alterar dados originais',()=>{
 const items=[{seq:1,historyChecked:true,movements:[e,{...e}]},{seq:2,historyChecked:true,movements:[e]}];
 const months=[m('2024-12',[owner],[],{[ne]:items}),m('2026-01',[payment],[link])];
 const before=JSON.stringify(months);
 const row=buildRapTrajectories(months,{totalMonths:35}).get(ne);
 assert.equal(row.history.groups.length,2);assert.equal(row.history.observations,3);
 assert.equal(row.history.repeated,1);assert.equal(row.history.groups[0].occurrences,2);
 assert.equal(row.history.groups[0].observedCents,5000);assert.equal(row.balanceCents,null);
 assert.equal(row.allMonthsLoaded,false);assert.equal(row.paymentEvidence,true);
 assert.equal(row.impacts[0].components.rpPaidCents,5000);assert.equal(row.impacts[0].components.rpInscribedCents,0);
 assert.equal(JSON.stringify(months),before);
});
test('vínculo temporal sozinho não comprova inscrição nem pagamento; campo ausente não vira zero',()=>{
 const row=buildRapTrajectories([m('2026-01',[payment],[{from:ob,to:ne2,cents:100}])]).get(ne2);
 assert.equal(row.originStatus,'unavailable');assert.equal(row.explicitRapEvidence,false);
 assert.equal(row.impacts[0].components.rpPaidCents,null);assert.equal(row.balanceCents,null);
 assert.equal(matchesRapTrajectory(row,{mode:'candidate',originYear:'2025'}),true);
 assert.equal(matchesRapTrajectory(row,{mode:'explicit'}),false);
 assert.equal(matchesRapTrajectory(row,{mode:'candidate',originYear:'2024'}),false);
});
test('identidades repetidas, pares repetidos e impacto ambíguo ficam indisponíveis',()=>{
 const d=m('2026-01',[payment],[link,link]);
 let row=buildRapTrajectories([m('2024-12',[owner]),d]).get(ne);
 assert.equal(row.impacts[0].status,'ambiguous_identity');assert.equal(row.paymentEvidence,false);
 row=buildRapTrajectories([m('2024-12',[owner]),m('2026-01',[payment],[{...link,impactComponents:{...c,rowCount:2,repeatedRows:1}}])]).get(ne);
 assert.equal(row.impacts[0].status,'ambiguous_impact');assert.equal(row.impacts[0].components.rpPaidCents,null);
 row=buildRapTrajectories([m('2024-12',[owner]),m('2026-01',[payment],[{...link,cents:999}])]).get(ne);
 assert.equal(row.impacts[0].status,'ambiguous_impact');
});
test('preserva componentes parciais de documento consultado, e não confunde identidade com valor',()=>{
 const row=buildRapTrajectories([m('2026-01',[payment,{id:ns,phase:2,relatedIds:[ne]}],
  [{...link,impactComponents:{...c,rpCancelledCents:null}}])]).get(ne);
 assert.equal(row.counts.partial,1);assert.equal(row.counts.unavailable,1);
 assert.equal(row.impacts.find(i=>i.id===ns).relatedOnly,true);
 assert.equal(row.impacts.find(i=>i.id===ob).components.rpCancelledCents,null);
 assert.equal(row.balanceCents,null);
});
test('rótulo qualificado tem regra fechada e proprietário repetido não fornece histórico confiável',()=>{
 assert.equal(qualifiedRapInscription('Inscrição em RP'),true);
 assert.equal(qualifiedRapInscription('INSCRICAO'),false);
 assert.equal(qualifiedRapInscription('CANCELAMENTO DE INSCRICAO EM RP'),false);
 const a=m('2024-12',[owner],[],{[ne]:[{seq:1,historyChecked:true,movements:[e]}]});
 const row=buildRapTrajectories([a,m('2025-01',[owner])]).get(ne);
 assert.equal(row.originStatus,'ambiguous');assert.equal(row.history.observations,0);
 assert.equal(row.explicitRapEvidence,false);
});
test('escopo 2024, fase e consulta comprovada; componente de RP explícito no mesmo exercício é evidência documental',()=>{
 const old='158459264222023NE000001',same='158459264222026NE000001';
 const data=m('2026-01',[payment],[{...link,to:old},{...link,to:same}]);
 const index=buildRapTrajectories([data]);assert.equal(index.has(old),false);
 assert.equal(index.get(same).paymentEvidence,true);assert.equal(index.get(same).counts.interannual,0);
 const unchecked=buildRapTrajectories([m('2026-01',[{...payment,paymentLinksChecked:false}],[link])]).get(ne);
 assert.equal(unchecked.paymentEvidence,false);assert.equal(unchecked.impacts[0].status,'unavailable');
});


const ne26='158459264222026NE000010';
const today='2026-01-04';
function ready(){
 const data=m('2026-01',[{id:ne26,phase:1,date:'2026-01-01',itemsDetailVersion:2},
  {...payment,date:'2026-01-03'}],[{...link,to:ne26}],
  {[ne26]:[{seq:1,historyChecked:true,movements:[{...e,date:'2026-01-02'}]}]});
 data.coverage=['2026-01-01','2026-01-02','2026-01-03','2026-01-04'].flatMap(date=>
  [1,2,3].map(phase=>({date,phase,complete:true,invalid:0})));
 return data;
}
test('prontidão exclui dia aberto e não libera saldo ou homologação',()=>{
 const data=ready(),before=JSON.stringify(data),index=buildRapTrajectories([data],{today}),entry=index.get(ne26);
 assert.equal(entry.readiness.status,'reviewable');assert.deepEqual(entry.readiness.reasons,[]);
 assert.equal(entry.readiness.listing.expected,9);assert.equal(entry.readiness.listing.complete,9);
 assert.equal(entry.readiness.accountingReady,false);assert.equal(entry.balanceCents,null);
 assert.equal(matchesRapTrajectory(entry,{mode:'reviewable'}),true);
 assert.equal(matchesRapTrajectory(entry,{mode:'pending'}),false);
 const sum=summarizeRapReadiness(index);assert.equal(sum.reviewable,1);assert.equal(sum.accountingReady,0);
 assert.ok(!JSON.stringify(sum).includes(ne26));assert.equal(JSON.stringify(data),before);
});
test('lacunas, consulta inválida e duplicidade não contam como cobertura completa',()=>{
 for(const change of [d=>d.coverage.pop()&&d.coverage.shift(),d=>d.coverage[0].invalid=1,
  d=>d.coverage.push({...d.coverage[0]}),d=>d.coverage[0].complete=false]){
  const data=ready();change(data);const row=buildRapTrajectories([data],{today}).get(ne26);
  assert.equal(row.readiness.status,'gaps');assert.equal(row.readiness.listing.complete,8);
  assert.ok(row.readiness.reasons.includes('listing_partial'));
 }
 assert.ok(buildRapTrajectories([ready()],{today,totalMonths:2}).get(ne26).readiness.reasons.includes('months_missing'));
});
test('referência sem inscrição e sem componente não vira evidência',()=>{
 const index=buildRapTrajectories([m('2026-01',[payment],[{from:ob,to:ne2,cents:100}])],{today});
 const row=index.get(ne2);assert.equal(row.readiness.status,'reference_only');
 assert.ok(row.readiness.reasons.includes('origin_missing'));assert.ok(row.readiness.reasons.includes('inscription_missing'));
 assert.ok(row.readiness.reasons.includes('impacts_incomplete'));
 assert.equal(summarizeRapReadiness(index).reference_only,1);
});
test('repetições, operações não esclarecidas e outros vínculos bloqueiam prontidão',()=>{
 const data=ready(),item=data.itemsByDocument[ne26][0];
 item.movements.push({...item.movements[0]},{...item.movements[0],operation:'ESTORNO'});
 data.documents.push({id:ns,phase:2,date:'2026-01-01',relatedIds:[ne26]});
 const row=buildRapTrajectories([data],{today}).get(ne26);
 for(const k of ['inscription_repeated','other_operations','impacts_incomplete'])assert.ok(row.readiness.reasons.includes(k));
 assert.equal(row.readiness.otherIncomplete,1);
});

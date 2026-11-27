import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {persistWindow,validatePublishedData,validateMonth} from '../src/store.mjs';
import {auditMonth} from '../assets/quality.js';
import {buildCommitmentChronology,commitmentChronologyEvidence} from '../assets/siafi-movement-reconciliation.js';
import {prioritizeObservedCommitments} from '../src/enrich-month.mjs';
const id='158459000012026NE000001',other='158459000012026NE000002';
const now=new Date('2026-11-27T17:00:00Z');
const patch=(date,ids,cents=150)=>({documents:ids.map(id=>({id,date,phase:1,cents})),links:[],coverage:{date,phase:1,count:ids.length,invalid:0,complete:true}});
test('NE reaparece em outro mes sem duplicar identidade nem valor; cobertura preservada',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ne-chronology-'));
 try{
  await persistWindow(root,[patch('2026-10-10',[id],100)],now);
  await persistWindow(root,[patch('2026-11-25',[id,other])],now);
  const {months}=await validatePublishedData(root);
  assert.equal(months[0].documents[0].cents,100);
  assert.deepEqual(months[1].documents.map(d=>d.id),[other]);
  assert.deepEqual(months[1].commitmentObservations,[{id,date:'2026-11-25',ownerDate:'2026-10-10',cents:150}]);
  assert.equal(months[1].coverage[0].count,2);
  assert.deepEqual(auditMonth(months[1],{now}).issues,[]);
  assert.equal((await persistWindow(root,[patch('2026-11-25',[id,other])],now)).updatedMonths.length,0);
  await assert.rejects(persistWindow(root,[patch('2026-10-10',[])],now),{code:'CGU_NE_LISTING_CHANGED'});
  await assert.rejects(persistWindow(root,[patch('2026-11-25',[other])],now),{code:'CGU_NE_LISTING_CHANGED'});
 }finally{await rm(root,{recursive:true,force:true})}
});
const doc={id,phase:1,date:'2026-11-10',cents:100,itemsDetailVersion:2};
const observations=[{id,date:'2026-11-25',ownerDate:doc.date,cents:150}];
const items=[{seq:1,cents:150,historyChecked:true,movements:[
 {date:'2026-10-01',type:'original',cents:100},
 {date:'2026-11-10',type:'reinforcement',cents:20},
 {date:'2026-11-25',type:'reinforcement',cents:40},
 {date:'2026-11-25',type:'annulment',cents:10}]}];
test('fluxo por data de operacao, nao data de listagem, sem duplicar valor corrente',()=>{
 const m={documents:[doc],itemsByDocument:{[id]:items},commitmentObservations:observations};
 const r=buildCommitmentChronology([m],{today:'2026-11-27'});
 assert.equal(r.reconciled,1);assert.equal(r.periods['2026-10'].initialCents,100);
 assert.equal(r.periods['2026-11'].netCents,50);
 assert.equal(r.periods['2026-11'].reinforcementCents,60);
 assert.equal(r.periods['2026-11'].annulmentCents,10);
 assert.equal(commitmentChronologyEvidence(doc,items,observations).originalDate,'2026-10-01');
});
test('nao apura historico parcial, divergente ou identidade duplicada',()=>{
 const partial=[{...items[0],historyChecked:false}];
 assert.notEqual(commitmentChronologyEvidence(doc,partial,observations).status,'reconciled');
 assert.notEqual(commitmentChronologyEvidence(doc,items,[]).status,'reconciled');
 const r=buildCommitmentChronology([{documents:[doc]},{documents:[doc]}],{today:'2026-11-27'});
 assert.equal(r.duplicateIdentities,1);assert.deepEqual(r.periods,{});
});
test('cancelamentos de NEs anteriores nao entram na execucao do exercicio corrente',()=>{
 const id='158459000012025NE000003';
 const m={documents:[{id,phase:1,date:'2025-12-01',cents:80,itemsDetailVersion:2}],itemsByDocument:{[id]:[
 {seq:1,cents:80,historyChecked:true,movements:[{date:'2025-12-01',type:'original',cents:100},{date:'2026-11-25',type:'cancellation',cents:20}]}]}};
 const r=buildCommitmentChronology([m],{today:'2026-11-27'});
 assert.equal(r.periods['2026-11'].netCents,0);assert.equal(r.periods['2026-11'].priorYearCancellationCents,20);
});
test('prioridade de historicos de reaparições nao amplia a fila',()=>{
 const tasks=[{kind:'itemHistory',id:other,month:'2026-11',seq:1}];
 const m={month:'2026-11',documents:[doc],commitmentObservations:observations,itemsByDocument:{[id]:items}};
 const r=prioritizeObservedCommitments(tasks,[m]);
 assert.equal(r.length,1);assert.equal(r[0].id,id);
});

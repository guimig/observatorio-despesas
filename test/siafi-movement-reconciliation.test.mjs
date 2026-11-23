import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reconcileSiafiCommitment,reconcileSiafiItem}
  from '../assets/siafi-movement-reconciliation.js';

const event=(type,cents,date='2026-01-16')=>({
 date,type,operation:type.toUpperCase(),cents,quantity:'1.00',unitPrice:'1.00'
});
const item=(cents,movements,checked=true)=>({
 seq:1,cents,movements,...(checked?{historyChecked:true}:{})
});
const check=(items,documentCents=null,listingDate='2026-11-17')=>
 reconcileSiafiCommitment(items,{listingDate,documentCents});

test('uma unica inclusao, inclusive NE 000288, tem valor inicial igual ao atual',()=>{
 const a=check([
  item(30000,[event('original',30000,'2026-11-18')]),
  item(15000,[event('original',15000,'2026-11-18')]),
  item(20000,[event('original',20000,'2026-11-18')]),
  item(14485,[event('original',14485,'2026-11-18')])
 ],79485,'2026-11-18');
 assert.equal(a.status,'reconciled');
 assert.equal(a.initialCents,79485);
 assert.equal(a.reinforcementCents,0);
 assert.equal(a.annulmentCents,0);
 assert.equal(a.reconstructedCents,79485);
 assert.equal(a.matchesDocument,true);
 assert.equal(a.originalDateMatchesListing,true);
 assert.equal(a.movements,4);
 assert.equal(Object.hasOwn(a,'remainingToPayCents'),false);
});

test('reconstroi valor atualizado com reforcos e anulacoes de tipo declarado',()=>{
 const a=check([item(59491052,[
  event('original',20000000),
  event('reinforcement',78999893,'2026-04-10'),
  event('annulment',39508841,'2026-09-04')
 ])],59491052);
 assert.equal(a.status,'reconciled');
 assert.equal(a.initialCents,20000000);
 assert.equal(a.reinforcementCents,78999893);
 assert.equal(a.annulmentCents,39508841);
 assert.equal(a.cancellationCents,0);
 assert.equal(a.reconstructedCents,59491052);
 assert.equal(a.originalDate,'2026-01-16');
 assert.equal(a.originalDateMatchesListing,false);
});

test('históricos pendentes ou vazios nao geram valores aparentemente completos',()=>{
 const incomplete=check([item(30000,[event('original',30000)]),
   item(5000,[],false)],35000);
 assert.equal(incomplete.status,'partial');
 assert.equal(incomplete.initialCents,null);
 const empty=check([item(5000,[])],5000);
 assert.equal(empty.status,'unavailable');
 assert.equal(empty.reason,'no_movement_evidence');
 assert.equal(check(null).status,'unavailable');
});

test('operacoes ambiguas, cancelamento e estorno nao recebem sinal presumido',()=>{
 for(const type of ['reversal','cancellation','other','unknown']){
  const a=check([item(100,[event('original',100),event(type,50)])],100);
  assert.equal(a.status,'unavailable');
  assert.equal(a.reason,type==='cancellation'?
   'cancellation_year_unverified':'ambiguous_movement');
 }
});

test('sinais negativos, varias inclusoes e anulacao superior a base nao sao aceitos',()=>{
 assert.equal(check([item(100,[event('original',100),
  event('annulment',-10)])]).status,'unavailable');
 assert.equal(check([item(200,[event('original',100),
  event('original',100,'2026-02-01')])]).reason,'multiple_originals');
 assert.equal(check([item(100,[event('original',100),
  event('annulment',200,'2026-02-01')])]).reason,'arithmetic_or_sequence_invalid');
 assert.equal(check([item(100,[event('reinforcement',50),
  event('original',50,'2026-03-01')])]).reason,'movement_before_original');
});

test('divergencias com valor atual ou valor do documento sao preservadas, nunca corrigidas',()=>{
 const itemDifference=check([item(120,[event('original',100)])],120);
 assert.equal(itemDifference.status,'divergent');
 assert.equal(itemDifference.reconstructedCents,100);
 assert.equal(itemDifference.reportedCents,120);
 const documentDifference=check([item(100,[event('original',100)])],110);
 assert.equal(documentDifference.status,'divergent');
 assert.equal(documentDifference.matchesDocument,false);
});

test('homologacao de quatro NEs com movimentos reais do acervo de novembro',async()=>{
 const dataset=JSON.parse(await readFile('data/months/2026-11.json','utf8'));
 const cases=[
  ['NE000005',20000000,78999893,39508841,59491052,'2026-01-16'],
  ['NE000216',2800000,170000,0,2970000,'2026-07-10'],
  ['NE000258',3612500,3717500,0,7330000,'2026-10-07'],
  ['NE000281',40000,250000,0,290000,'2026-11-11']
 ];
 for(const [suffix,base,plus,minus,expected,originalDate] of cases){
  const doc=dataset.documents.find(x=>x.id.endsWith(suffix));
  assert.ok(doc,'NE historica presente para '+suffix);
  const items=dataset.itemsByDocument[doc.id];
  assert.ok(items?.length);
  const a=check(items,doc.cents,doc.date);
  assert.equal(a.status,'reconciled',suffix);
  assert.equal(a.initialCents,base,suffix);
  assert.equal(a.reinforcementCents,plus,suffix);
  assert.equal(a.annulmentCents,minus,suffix);
  assert.equal(a.reconstructedCents,expected,suffix);
  assert.equal(a.originalDate,originalDate,suffix);
  assert.equal(a.originalDateMatchesListing,false,suffix);
  assert.equal(a.matchesDocument,true,suffix);
 }
});

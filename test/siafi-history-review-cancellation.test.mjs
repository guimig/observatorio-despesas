import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyMonth,mergeMonth,applyDocumentEnrichment,validateMonth} from '../src/store.mjs';
import {planEnrichment} from '../src/enrich-month.mjs';
import {reconcileSiafiCommitment} from '../assets/siafi-movement-reconciliation.js';

const ne='158459264222025NE000009';
const day='2025-12-08';
const included={date:'2025-11-25',operation:'INCLUSAO',type:'original',
 quantity:'10.00',unitPrice:'10.00',cents:10000};
const canceled={date:'2026-02-03',operation:'CANCELAMENTO',type:'cancellation',
 quantity:'2.00',unitPrice:'10.00',cents:2000};
const item={seq:1,cents:10000};
const base=()=>mergeMonth(emptyMonth('2025-12'),'2025-12',[{
 documents:[{id:ne,phase:1,date:day,cents:10000}],links:[],
 coverage:{date:day,phase:1,complete:true,count:1,invalid:0}
}]).data;
const withHistory=()=>applyDocumentEnrichment(
 applyDocumentEnrichment(base(),ne,{kind:'items',items:[item]}).data,
 ne,{kind:'itemHistory',seq:1,movements:[included],checkedAt:'2026-10-01'}).data;

test('historico concluido de NE antiga entra na fila apos sete dias',()=>{
 const data=withHistory();
 assert.equal(planEnrichment(data,{now:new Date('2026-10-06T12:00:00Z')}).itemRechecks.length,0);
 assert.deepEqual(planEnrichment(data,{now:new Date('2026-10-08T12:00:00Z')}).itemRechecks,
  [{id:ne,seq:1}]);
});
test('reconsulta idempotente atualiza checkpoint sem criar duplicatas',()=>{
 let data=withHistory();
 const patch={kind:'itemHistory',seq:1,movements:[included],checkedAt:'2026-11-22'};
 data=applyDocumentEnrichment(data,ne,patch).data;
 assert.equal(data.itemsByDocument[ne][0].historyCheckedAt,'2026-11-22');
 assert.equal(data.itemsByDocument[ne][0].movements.length,1);
 assert.equal(applyDocumentEnrichment(data,ne,patch).changed,false);
 assert.doesNotThrow(()=>validateMonth(data));
 assert.equal(planEnrichment(data,{now:new Date('2026-11-23T12:00:00Z')}).itemRechecks.length,0);
});
test('reconsulta nao apaga movimento anterior em resposta vazia ou substituida',()=>{
 const data=withHistory();
 assert.throws(()=>applyDocumentEnrichment(data,ne,{
  kind:'itemHistory',seq:1,movements:[],checkedAt:'2026-11-22'
 }),/Reconsulta vazia/);
 assert.throws(()=>applyDocumentEnrichment(data,ne,{
  kind:'itemHistory',seq:1,movements:[{...included,cents:9999}],checkedAt:'2026-11-22'
 }),/divergente/);
 assert.equal(data.itemsByDocument[ne][0].movements[0].cents,10000);
});
test('cancelamento de item posterior ao ano da NE e separado de anulacao',()=>{
 const result=reconcileSiafiCommitment([{seq:1,cents:8000,historyChecked:true,
  movements:[included,canceled]}],{
  listingDate:'2025-12-08',documentCents:8000,commitmentYear:'2025'});
 assert.equal(result.status,'reconciled');
 assert.equal(result.cancellationCents,2000);
 assert.equal(result.annulmentCents,0);
 assert.equal(result.reconstructedCents,8000);
 assert.equal(Object.hasOwn(result,'rapBalanceCents'),false);
});
test('cancelamento no proprio exercicio ou ano desconhecido nao reconstrui',()=>{
 const sameYear={...canceled,date:'2025-12-29'};
 for(const year of ['2025',null]){
  const result=reconcileSiafiCommitment([{seq:1,cents:8000,historyChecked:true,
   movements:[included,year===null?canceled:sameYear]}],{commitmentYear:year});
  assert.equal(result.status,'unavailable');
  assert.equal(result.reason,'cancellation_year_unverified');
 }
});
test('estorno e natureza ambigua continuam bloqueados mesmo com ano conhecido',()=>{
 const result=reconcileSiafiCommitment([{seq:1,cents:8000,historyChecked:true,
  movements:[included,{...canceled,type:'reversal',operation:'ESTORNO'}]}],{
  commitmentYear:'2025'});
 assert.equal(result.status,'unavailable');
 assert.equal(result.reason,'ambiguous_movement');
});

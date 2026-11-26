import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyMonth,mergeMonth,validateMonth} from '../src/store.mjs';
import {planClassificationReview,applyClassificationPatch,classificationKey} from '../src/cgu-classification-review.mjs';
const now=new Date('2026-11-26T12:00:00Z'),day='2024-05-03',id='158459264222024NE000123';
const doc={id,date:day,phase:1,cents:100,nature:{action:'20RL',budgetPlan:'0000',locator:'0042',subtitle:'20RL0042'}};
const patch=d=>({documents:[d],links:[],coverage:{date:day,phase:1,complete:true,count:1,invalid:0}});
const old=mergeMonth(emptyMonth('2024-05'),'2024-05',[patch(doc)],now).data;
test('revisa datas historicas e respeita recorte e checkpoint de campos ausentes',()=>{
 assert.deepEqual(planClassificationReview([old],{now}),[{date:day,phase:1}]);
 assert.deepEqual(planClassificationReview([old],{now,exclude:[day+'/1']}),[]);
 const checked=applyClassificationPatch(old,patch({...doc,nature:{...doc.nature,function:'12'}}),{now});
 assert.equal(checked.data.documents[0].natureCheckedAt,'2026-11-26');
 assert.deepEqual(planClassificationReview([checked.data],{now}),[]);
 assert.deepEqual(planClassificationReview([{...old,month:'2023-05'}],{now}),[]);
});
test('enriquece so classificacao; invalida PO/localizador/subtitulo se contexto alterado',()=>{
 const result=applyClassificationPatch(old,patch({...doc,nature:{action:'2994',function:'12'}}),{now});
 const d=result.data.documents[0];
 assert.equal(d.nature.action,'2994');assert.equal(d.nature.budgetPlan,undefined);
 assert.equal(d.nature.locator,undefined);assert.equal(d.nature.subtitle,undefined);
 assert.equal(d.cents,100);assert.equal(d.date,day);
 assert.deepEqual(result.data.coverage,old.coverage);assert.deepEqual(result.data.relations,old.relations);
 assert.doesNotThrow(()=>validateMonth(result.data));
 assert.equal(applyClassificationPatch(old,patch({...doc,cents:999}),{now}).changed,false);
 assert.throws(()=>applyClassificationPatch(old,{...patch(doc),coverage:{...patch(doc).coverage,complete:false}},{now}));
});

test('classificacao identica registra reconferencia no cache sem alterar JSON',()=>{
 const first=applyClassificationPatch(old,patch(doc),{now:new Date('2025-01-01')}).data;
 const state={};
 const result=applyClassificationPatch(first,patch(doc),{now,state});
 assert.equal(result.changed,false);
 assert.equal(state[classificationKey(first.documents[0])],'2026-11-26');
 assert.deepEqual(planClassificationReview([first],{now,state}),[]);
 assert.equal(applyClassificationPatch(first,patch({...doc,nature:{...doc.nature,function:'12'}}),{now,state}).changed,true);
});

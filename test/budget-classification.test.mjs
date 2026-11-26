import {test} from 'node:test';
import assert from 'node:assert/strict';
import {budgetBucket,observedCode,referenceFor,summarizeBudget} from '../assets/budget-classification.js';
const doc={phase:1,date:'2026-11-01',cents:100,nature:{action:'20RL - Funcionamento',budgetPlan:'0000 - Plano'}};
test('PO depende de acao e exercicio; ausencia e multiplos nao viram codigo',()=>{
 assert.equal(observedCode(doc.nature.budgetPlan,'budgetPlan'),'0000');
 const b=budgetBucket(doc,'budgetPlan');
 assert.notEqual(b.key,budgetBucket({...doc,date:'2025-11-01'},'budgetPlan').key);
 assert.notEqual(b.key,budgetBucket({...doc,nature:{...doc.nature,action:'2994 - Assistencia'}},'budgetPlan').key);
 assert.equal(budgetBucket({...doc,nature:{budgetPlan:'0000'}},'budgetPlan').key,'context_missing');
 assert.equal(budgetBucket({...doc,nature:{group:'M - Múltiplo'}},'group').key,'multiple');
 assert.equal(budgetBucket({...doc,nature:{action:'-14 - Múltiplo'}},'action').key,'multiple');
 assert.equal(budgetBucket({...doc,nature:{}},'action').key,'missing');
});
test('somente PI integral confirmado, sem rateio de multiplos ou atribuir candidato',()=>{
 assert.equal(budgetBucket(doc,'pi').key,'missing');
 assert.equal(budgetBucket(doc,'pi',{confirmedPi:['A','B']}).key,'multiple');
 assert.equal(budgetBucket(doc,'pi',{confirmedPi:['A','A']}).code,'A');
 assert.equal(budgetBucket({...doc,phase:2},'pi',{confirmedPi:['A']}).key,'missing');
});
test('SIOP referencia por codigo ano e acao; nao atribui fonte ausente',()=>{
 const c={dictionaries:[{year:2026,rows:[{kind:'budgetPlan',code:'0000',action:'20RL',label:'SIOP Plano'},{kind:'budgetPlan',code:'0000',action:'2994',label:'Outro'}]}]};
 assert.equal(referenceFor(c,budgetBucket(doc,'budgetPlan'),'budgetPlan'),'SIOP Plano');
 assert.equal(referenceFor(c,budgetBucket({...doc,date:'2025-11-01'},'budgetPlan'),'budgetPlan'),null);
 assert.equal(referenceFor(c,budgetBucket({...doc,nature:{}},'budgetPlan'),'budgetPlan'),null);
});
test('agrupa cada documento uma vez e valores apenas por fase original, distinguindo desconhecido e negativo',()=>{
 const a=summarizeBudget([{doc},{doc:{...doc,phase:2,cents:null}},{doc:{...doc,cents:-20}}],'action');
 assert.equal(a.length,1);assert.equal(a[0].count,3);
 assert.deepEqual(a[0].phase[1],{count:2,known:2,unknown:0,cents:80});
 assert.deepEqual(a[0].phase[2],{count:1,known:0,unknown:1,cents:0});
});

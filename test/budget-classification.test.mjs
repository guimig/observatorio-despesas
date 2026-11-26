import {test} from 'node:test';
import assert from 'node:assert/strict';
import {budgetBucket,observedCode,referenceFor,summarizeBudget,matchesBudgetFilters,budgetFacetOptions} from '../assets/budget-classification.js';
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

test('filtros combinam E entre dimensoes, OU na mesma dimensao e exclusao contextual',()=>{
 const a={...doc,nature:{...doc.nature,group:'3 - ODC'}};
 const action=budgetBucket(a,'action').key,group=budgetBucket(a,'group').key;
 const filters={action:[action,'missing'],group:[group]};
 assert.equal(matchesBudgetFilters(a,filters),true);
 assert.equal(matchesBudgetFilters({...a,nature:{...a.nature,group:'4 - Investimento'}},filters),false);
 assert.equal(matchesBudgetFilters({...a,nature:{...a.nature,group:'4 - Investimento'}},filters,{except:'group'}),true);
 assert.equal(matchesBudgetFilters({...a,nature:{...a.nature,action:'2994'}},filters),false);
 assert.equal(matchesBudgetFilters(a,{}),true);
});

test('facetas mantem opcoes sem correspondencia e contagem condicionada; PI tem chave consistente',()=>{
 const a={...doc,nature:{...doc.nature,group:'3 - ODC'}},b={...doc,nature:{action:'2994',group:'4 - Investimentos'}};
 const groups=budgetFacetOptions([{doc:a},{doc:b}],'action',{group:[budgetBucket(a,'group').key]});
 assert.equal(groups.length,2);
 assert.equal(groups.find(g=>g.code==='2994').compatible,0);
 assert.equal(groups.find(g=>g.code==='20RL').compatible,1);
 assert.deepEqual(JSON.parse(budgetBucket(a,'pi',{confirmedPi:['ABC']}).key),['2026','pi',null,'ABC']);
});

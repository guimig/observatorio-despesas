import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditSiafiItemMovements} from '../assets/siafi-movement-audit.js';

const emissionDate='2026-11-18';
const amounts=[30000,15000,20000,14485];
const quantities=['10.00','5.00','2.00','5.00'];
const prices=['30.00','30.00','100.00','28.97'];
const items=()=>amounts.map((cents,i)=>({
 seq:i+1,cents,historyChecked:true,
 movements:[{date:emissionDate,operation:'INCLUSAO',type:'original',
   quantity:quantities[i],unitPrice:prices[i],cents}]
}));
const audit=(records,amount=79485)=>auditSiafiItemMovements(records,{
 issueDate:emissionDate,documentCents:amount
});

test('NE 000288 quatro itens: inclusão original coincide com soma de R$ 794,85',()=>{
 const result=audit(items());
 assert.equal(result.status,'original_only_consistent');
 assert.deepEqual([result.totalItems,result.checked,result.pending],[4,4,0]);
 assert.equal(result.counts.original,4);
 assert.equal(result.counts.reinforcement,0);
 assert.equal(result.counts.annulment,0);
 assert.equal(result.currentItemsCents,79485);
 assert.equal(result.documentAmountMatch,true);
 assert.equal(result.originalItemMismatches,0);
});

test('três históricos validados e hexano pendente não viram NE completa',()=>{
 const records=items();
 delete records[3].historyChecked;
 delete records[3].movements;
 const result=audit(records);
 assert.equal(result.status,'partial');
 assert.equal(result.checked,3);
 assert.equal(result.pending,1);
 assert.equal(result.documentAmountMatch,true);
});

test('reforço e anulação oficiais exigem revisão e não calculam saldo',()=>{
 const records=items();
 records[0].movements.push({
  date:'2026-11-20',operation:'REFORCO',type:'reinforcement',
  quantity:'2.00',unitPrice:'30.00',cents:6000
 },{
  date:'2026-11-21',operation:'ANULACAO',type:'annulment',
  quantity:'1.00',unitPrice:'30.00',cents:3000
 });
 const result=audit(records);
 assert.equal(result.status,'additional_operations');
 assert.equal(result.counts.reinforcement,1);
 assert.equal(result.counts.annulment,1);
 assert.equal(result.currentItemsCents,79485);
 assert.equal(result.originalItemMismatches,1);
 assert.equal(Object.hasOwn(result,'netBalanceCents'),false);
});

test('diferença entre valores documentais exige revisão e não substitui fonte',()=>{
 const records=items();
 records[1].movements[0].cents=14900;
 const result=audit(records);
 assert.equal(result.status,'requires_review');
 assert.equal(result.originalItemMismatches,1);
 assert.equal(result.documentAmountMatch,true);
 assert.equal(audit(items(),79484).status,'requires_review');
});

test('histórico consultado sem linhas e falta de itens não comprovam ausência de operações',()=>{
 const records=items();
 records[2].movements=[];
 const result=audit(records);
 assert.equal(result.status,'no_movement_evidence');
 assert.equal(result.emptyHistories,1);
 assert.equal(auditSiafiItemMovements(null).status,'unavailable');
 assert.equal(audit([],79485).status,'no_items');
});

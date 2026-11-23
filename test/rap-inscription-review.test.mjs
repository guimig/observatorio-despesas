import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inscriptionLabelEvidence,reviewInscriptionTextEvent,
 emptyInscriptionEvidence,addInscriptionEvidence,mergeInscriptionEvidence}
 from '../src/rap-inscription-review.mjs';

test('rótulos exatos, qualificados e pistas são categorias estritamente documentais',()=>{
 assert.equal(inscriptionLabelEvidence('INSCRIÇÃO'),'exact');
 assert.equal(inscriptionLabelEvidence('INSCRICAO'),'exact');
 assert.equal(inscriptionLabelEvidence('Inscrição de Restos a Pagar'),'qualified');
 assert.equal(inscriptionLabelEvidence('Inscrição em RP'),'qualified');
 assert.equal(inscriptionLabelEvidence('Inscrição Especial 2025'),'other_with_hint');
 assert.equal(inscriptionLabelEvidence('Reinscrição'),'not_inscription');
 assert.equal(inscriptionLabelEvidence('Cancelamento'),'not_inscription');
 assert.equal(inscriptionLabelEvidence('Valor 123'), 'not_inscription');
 assert.equal(inscriptionLabelEvidence(null),'missing');
});
test('pistas temporais e sinais preservam casos-limite sem interpretar saldo',()=>{
 const base={operation:'INSCRIÇÃO',date:'2026-01-05',cents:7500};
 assert.deepEqual(reviewInscriptionTextEvent(base,2025),{
   label:'exact',year:'following',amountSign:'positive'});
 assert.equal(reviewInscriptionTextEvent({...base,date:'2025-12-31'},2025).year,'same');
 assert.equal(reviewInscriptionTextEvent({...base,date:'2027-01-01'},2025).year,'later');
 assert.equal(reviewInscriptionTextEvent({...base,date:'2024-01-01'},2025).year,'before');
 assert.equal(reviewInscriptionTextEvent({...base,date:'2026-02-30'},2025).year,'invalid');
 assert.equal(reviewInscriptionTextEvent({...base,cents:-1},2025).amountSign,'negative');
 assert.equal(reviewInscriptionTextEvent({...base,cents:0},2025).amountSign,'zero');
 assert.equal(reviewInscriptionTextEvent({...base,cents:'100'},2025).amountSign,'unavailable');
 assert.throws(()=>reviewInscriptionTextEvent(base,1999));
 assert.throws(()=>reviewInscriptionTextEvent(null,2025));
});
test('agregação soma categorias fechadas, não dados individuais',()=>{
 const one=emptyInscriptionEvidence();
 const two=emptyInscriptionEvidence();
 addInscriptionEvidence(one,reviewInscriptionTextEvent({
   operation:'Inscrição de RP',date:'2026-01-01',cents:100},2025));
 addInscriptionEvidence(two,reviewInscriptionTextEvent({
   operation:'MOVIMENTO SEM IDENTIFICAÇÃO CPF 000.111.222-33',date:'invalid',cents:null},2025));
 mergeInscriptionEvidence(one,two);
 assert.equal(one.candidateMovements,2);
 assert.equal(one.labels.qualified,1);
 assert.equal(one.labels.not_inscription,1);
 assert.equal(one.years.following,1);
 assert.equal(one.years.invalid,1);
 assert.equal(one.amountSigns.unavailable,1);
 const serialized=JSON.stringify(one);
 for(const privateValue of ['CPF','000.111.222-33','2026-01-01','100'])
   assert.equal(serialized.includes(privateValue),false);
 assert.throws(()=>addInscriptionEvidence(one,{label:'CPF',year:'following',amountSign:'positive'}));
 assert.throws(()=>mergeInscriptionEvidence(one,{candidateMovements:1,labels:{exact:-1}}));
});

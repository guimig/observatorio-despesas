import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditMonth,closedDaysInMonth } from '../assets/quality.js';

const now=new Date('2026-11-19T20:00:00Z');
const ne='158459000012026NE000001',oldNe='158459000012025NE000002';
const ns='158459000012026NS000001',ob='158459000012026OB000001';
function sample(){
  return {month:'2026-11',documents:[
    {id:ne,date:'2026-11-18',phase:1,cents:4000},
    {id:ns,date:'2026-11-18',phase:2,cents:1000,liquidationLinksChecked:true},
    {id:ob,date:'2026-11-18',phase:3,cents:500,paymentLinksChecked:true}
  ],coverage:[1,2,3].map(phase=>({
    date:'2026-11-18',phase,complete:true,count:1,invalid:0
  })),relations:[
    {from:ns,to:ne,cents:1200},{from:ns,to:oldNe,cents:-200},
    {from:ob,to:oldNe,cents:500}
  ],itemsByDocument:{[ne]:[]}};
}
test('dias encerrados respeitam fuso brasileiro, virada de mês e fevereiro bissexto',()=>{
  assert.equal(closedDaysInMonth('2026-11',now),18);
  assert.equal(closedDaysInMonth('2026-10',now),31);
  assert.equal(closedDaysInMonth('2026-12',now),0);
  assert.equal(closedDaysInMonth('2024-02',now),29);
  assert.throws(()=>closedDaysInMonth('2026-13',now));
});
test('cobertura incompleta é diferente de vínculo ainda não consultado',()=>{
  const audit=auditMonth(sample(),{now});
  assert.deepEqual([audit.coverage.expectedDays,audit.coverage.completeDays,
    audit.coverage.partialDays,audit.coverage.missingDays],[18,1,0,17]);
  assert.equal(audit.coverage.status,'parcial');
  assert.equal(audit.enrichment.pending,0);
  assert.deepEqual(audit.issues,[]);
});
test('N:M, anulação e restos a pagar são contextos de auditoria, não falhas automáticas',()=>{
  const audit=auditMonth(sample(),{now});
  assert.equal(audit.links.total,3);
  assert.equal(audit.links.multipleCommitments,1);
  assert.equal(audit.links.negative,1);
  assert.equal(audit.links.crossExercise,2);
  assert.equal(audit.links.liquidationValueReviews,0);
  assert.deepEqual(audit.issues,[]);
});
test('divergência nominal em NS consultada gera revisão não bloqueante',()=>{
  const data=sample();
  data.documents[1].cents=1500;
  assert.equal(auditMonth(data,{now}).links.liquidationValueReviews,1);
  assert.equal(auditMonth(data,{now}).issues.length,0);
});
test('marcadores pendentes e cobertura parcial são mensurados separadamente',()=>{
  const data=sample();
  delete data.documents[1].liquidationLinksChecked;
  delete data.documents[2].paymentLinksChecked;
  data.coverage[0].complete=false;
  data.coverage[0].invalid=1;
  const audit=auditMonth(data,{now});
  assert.equal(audit.enrichment.pending,2);
  assert.equal(audit.coverage.partialQueries,1);
  assert.equal(audit.coverage.partialDays,1);
  assert.equal(audit.coverage.completeDays,0);
});
test('vínculos duplicados são sinalizados para bloqueio estrutural',()=>{
  const data=sample();
  data.relations.push({...data.relations[0]});
  assert.ok(auditMonth(data,{now}).issues.includes('vinculo_duplicado'));
});

test('audita sobreposicao sem duplicar identidade nem declarar erro estrutural',()=>{
  const data=sample();
  data.phaseObservations=[{
    id:ns,date:'2026-11-18',phase:3,amountKnown:true,amountRelation:'different'
  }];
  data.coverage.find(c=>c.phase===3).count=2;
  const report=auditMonth(data,{now});
  assert.deepEqual(report.issues,[]);
  assert.equal(report.phaseObservations.total,1);
  assert.equal(report.phaseObservations.overlappingDocuments,1);
  assert.equal(report.phaseObservations.amountDisagreements,1);
  assert.equal(report.coverage.completeDays,1);
  assert.equal(report.links.total,3);
});

test('auditoria avisa quando fase adicional nao tem cobertura correspondente',()=>{
  const data=sample();
  data.phaseObservations=[{
    id:ns,date:'2026-11-17',phase:3,amountKnown:true,amountRelation:'same'
  }];
  assert.ok(auditMonth(data,{now}).issues.includes('observacao_fase_invalida'));
});

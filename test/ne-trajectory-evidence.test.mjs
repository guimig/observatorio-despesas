import {test} from 'node:test';
import assert from 'node:assert/strict';
import {otherOperationHint,planLinkedNeEvidence,inspectLinkedNeEvidence,
 summarizeLinkedNeEvidence} from '../src/ne-trajectory-evidence.mjs';
const prefix='15845926422';
const old=prefix+'2025NE000001',oldTwo=prefix+'2025NE000002';
const current=prefix+'2026NE000001';
const ob=prefix+'2026OB000001',ns=prefix+'2026NS000002';
const broken=prefix+'2026DF000003';
const months=[{month:'2026-11',data:{
 documents:[{id:ob,date:'2026-11-03',phase:3},
   {id:ns,date:'2026-11-04',phase:2},
   {id:broken,date:'2026-11-05',phase:3}],
 relations:[{from:ob,to:old},{from:ob,to:oldTwo},
   {from:ns,to:old},{from:broken,to:current}]
}}];
const targets=[{id:old,year:2025,otherLater:4},
 {id:oldTwo,year:2025,otherLater:1}];

test('pistas lexicais sao classes fechadas e nao implicam classificacao de operacao',()=>{
 assert.equal(otherOperationHint('REINSCRIÇÃO DE RP'),'reinscricao');
 assert.equal(otherOperationHint('Inscrição de restos a pagar'),'inscricao');
 assert.equal(otherOperationHint('Baixa'), 'baixa');
 assert.equal(otherOperationHint('ajuste contábil com CPF 000.000.000-00'),'ajuste');
 assert.equal(otherOperationHint('ATO DESCONHECIDO + CPF 000.000.000-00'),'sem_pista');
 assert.equal(otherOperationHint(null),'sem_pista');
});
test('vinculos N:M sao selecionados uma unica vez por documento e por fase',()=>{
 const plan=planLinkedNeEvidence(months,targets);
 assert.equal(plan.counts.targetsConsidered,2);
 assert.equal(plan.counts.notesSelected,2);
 assert.equal(plan.counts.documentsPlanned,2);
 assert.equal(plan.counts.documentsWithMultipleTargets,1);
 assert.equal(plan.counts.relationshipsPlanned,3);
 assert.equal(plan.documents[0].kind,'OB');
 assert.equal(plan.documents[0].neIds.length,2);
 assert.equal(plan.documents[1].kind,'NS');
 assert.equal(JSON.stringify(plan.counts).includes(old),false);
});
test('documento posterior incorreto, duplicata ambigua e dados invalidos nao entram',()=>{
 const invalid=[{month:'2026-11',data:{
   documents:[{id:broken,date:'2026-11-05',phase:3},
    {id:broken,date:'2026-11-08',phase:3}],
   relations:[{from:broken,to:old}]
 }}];
 const plan=planLinkedNeEvidence(invalid,targets);
 assert.equal(plan.counts.documentsPlanned,0);
 assert.throws(()=>planLinkedNeEvidence(months,[{id:old,year:2026,otherLater:1}]));
 assert.throws(()=>planLinkedNeEvidence([{month:'2026-11',data:{}}],targets));
 assert.throws(()=>planLinkedNeEvidence(months,targets,{maxNotes:0}));
});
test('documentos sem identidade financeira comprovada nao geram evidencias positivas',async()=>{
 const sample=planLinkedNeEvidence(months,targets).documents[0];
 let count=0;
 const audit=await inspectLinkedNeEvidence(sample,{token:'SECRET',
 request:async(_,options)=>{
   assert.equal(options.token,'SECRET');
   count++;
   if(count===1)return [
     {empenho:old,valorRestoPago:'10,00',valorRestoCancelado:'0'},
     {empenho:oldTwo,valorRestoPago:'0',valorRestoCancelado:'3,00'},
     {empenho:current,valorRestoPago:'999.999,00'},
     {empenho:'2025NE000001',valorRestoPago:'999.999,00'}];
   return [];
 }});
 assert.equal(audit.status,'complete');
 assert.equal(audit.matchedRows,2);
 assert.equal(audit.matchedTargets,2);
 assert.equal(audit.rowsOtherNE,1);
 assert.equal(audit.rowsUnknownNE,1);
 assert.equal(audit.fields.valorRestoPago.positive,1);
 assert.equal(audit.fields.valorRestoCancelado.positive,1);
 const summary=summarizeLinkedNeEvidence({documents:[sample],counts:{}},[audit]);
 assert.equal(summary.byKind.OB.withPositiveRestoPago,1);
 assert.equal(summary.byKind.OB.withPositiveRestoCancelado,1);
 assert.equal(summary.byKind.OB.matchedRelationships,2);
 for(const secret of [old,oldTwo,'999.999,00','10,00','SECRET'])
  assert.equal(JSON.stringify({audit,summary}).includes(secret),false);
});
test('sem pagina terminal ou em falha, sinais parciais sao eliminados',async()=>{
 const sample=planLinkedNeEvidence(months,targets).documents[0];
 const call=async request=>inspectLinkedNeEvidence(sample,
   {token:'SECRET',maxPages:2,request});
 const partial=await call(async()=>[{empenho:old,valorRestoPago:'90,00'}]);
 assert.equal(partial.status,'unavailable');
 assert.equal(partial.reason,'pagina_repetida');
 assert.equal(partial.fields.valorRestoPago.positive,0);
 let calls=0;
 const over=await call(async()=>[{empenho:old,valorRestoPago:String(++calls)}]);
 assert.equal(over.status,'partial');
 assert.equal(over.fields.valorRestoPago.positive,0);
 const failed=await call(async()=>{throw Error('token private CPF 123');});
 assert.equal(failed.status,'unavailable');
 assert.equal(JSON.stringify(failed).includes('123'),false);
 const empty=await call(async()=>[]);
 assert.equal(empty.status,'empty');
 const noMatch=await call((()=>{let n=0;return async()=>++n===1?[{empenho:current,valorRestoPago:'100'}]:[]})());
 assert.equal(noMatch.status,'no_match');
 assert.equal(noMatch.fields.valorRestoPago.positive,0);
});
test('historicos sem vinculo explícito nao viram pagamento confirmado',()=>{
 const sample=planLinkedNeEvidence(months,[{id:old,year:2025,otherLater:0}]);
 assert.equal(sample.counts.documentsPlanned,0);
 const unknown=planLinkedNeEvidence(months,[{id:prefix+'2025NE999999',year:2025,otherLater:2}]);
 assert.equal(unknown.counts.notesWithoutCandidates,1);
 assert.equal(unknown.counts.documentsPlanned,0);
});

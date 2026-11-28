import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateImpactComponents,validateImpactComponents,isRapInscription,reviewRapItem,summarizeRapEvidence,needsRapComponentReview} from '../src/rap-evidence.mjs';
import {resolvePaymentLinks,resolveLiquidationLinks} from '../src/enrich-cgu.mjs';
import {emptyMonth,applyDocumentEnrichment,validateMonth} from '../src/store.mjs';
const ne='158459264222024NE000001',ob='158459264222026OB000001',ns='158459264222026NS000001';
const rows=[{empenho:ne,subitem:'01',valorPago:'0,00',valorRestoPago:'45,00',valorRestoInscrito:'0,00',valorRestoCancelado:'3,00'},
 {empenho:ne,subitem:'02',valorPago:'10,00',valorRestoPago:'-5,00',valorRestoInscrito:'0,00',valorRestoCancelado:'0,00'}];
test('RAP: pagamento preserva componentes, sinais e zero explícito sem alterar cents legado',async()=>{
 const result=await resolvePaymentLinks(ob,{token:'fake',includeRapComponents:true,request:async(_,p)=>p===1?rows:[]});
 assert.equal(result.ok,true);
 assert.deepEqual(result.links,[{from:ob,to:ne,cents:5000,impactComponents:{
  rowCount:2,repeatedRows:0,liquidatedCents:null,paidCents:1000,rpInscribedCents:0,rpCancelledCents:300,rpPaidCents:4000}}]);
});
test('RAP: campo ausente em uma linha não vira zero; igualdade de linhas bloqueia agregação nova',()=>{
 const partial=aggregateImpactComponents([rows[0],{...rows[1],valorRestoCancelado:undefined}]);
 assert.equal(partial.rpCancelledCents,null);assert.equal(partial.rpPaidCents,4000);
 const duplicate=aggregateImpactComponents([rows[0],{...rows[0]}]);
 assert.equal(duplicate.repeatedRows,1);assert.equal(duplicate.rpPaidCents,null);
 assert.equal(duplicate.rpInscribedCents,null);
});
test('RAP: fase 2 preserva inscrição documental mesmo quando valor liquidado é zero',async()=>{
 const result=await resolveLiquidationLinks(ns,{token:'fake',includeRapComponents:true,request:async(_,p)=>p===1?
  [{empenho:{documento:ne},valorLiquidado:'0,00',valorRestoInscrito:'200,00',valorRestoCancelado:'0,00'}]:[]});
 assert.equal(result.ok,true);assert.equal(result.links[0].cents,0);
 assert.equal(result.links[0].impactComponents.rpInscribedCents,20000);
 assert.equal(result.links[0].impactComponents.rpPaidCents,null);
});
test('RAP: paginação incompleta não persiste componentes',async()=>{
 const result=await resolvePaymentLinks(ob,{token:'fake',includeRapComponents:true,limit:1,request:async()=>rows});
 assert.equal(result.ok,false);assert.equal(result.links,undefined);
});
test('RAP: esquema mensal admite componentes opcionais e valida identidade aritmética',()=>{
 const m=emptyMonth('2026-11');
 m.documents=[{id:ob,date:'2026-11-20',phase:3,cents:5000}];
 m.coverage=[{date:'2026-11-20',phase:3,count:1,invalid:0,complete:true}];
 const impactComponents=aggregateImpactComponents(rows);
 const link={from:ob,to:ne,cents:5000,impactComponents};
 const first=applyDocumentEnrichment(m,ob,{kind:'payment',links:[link]});
 assert.equal(first.changed,true);assert.deepEqual(first.data.relations,[link]);
 assert.equal(applyDocumentEnrichment(first.data,ob,{kind:'payment',links:[link]}).changed,false);
 assert.throws(()=>validateImpactComponents({...impactComponents,rpPaidCents:5000},link,3));
 assert.throws(()=>validateMonth({...first.data,relations:[{...link,impactComponents:{...impactComponents,repeatedRows:1}}]}));
});
test('RAP: rótulo exato qualificado é evidência separada; repetição não gera soma',()=>{
 const event={date:'2025-01-11',operation:'INSCRICAO EM RP',type:'other',quantity:'1',unitPrice:'50',cents:5000};
 assert.equal(isRapInscription(event),true);assert.equal(isRapInscription({operation:'INSCRICAO'}),false);
 const item={seq:1,historyChecked:true,movements:[event,{...event}]};
 assert.deepEqual(reviewRapItem(item),{observations:2,repeated:1,indistinguishable:true});
 const link={from:ob,to:ne,cents:5000,impactComponents:aggregateImpactComponents(rows)};
 const report=summarizeRapEvidence([{itemsByDocument:{[ne]:[item]},relations:[link]}]);
 assert.equal(report.notesWithInscription,1);assert.equal(report.inscriptionObservations,2);
 assert.equal(report.repeatedInscriptionObservations,1);assert.equal(report.positiveFields.rpPaidCents,1);
 assert.equal(report.priorYearPairs,1);assert.equal(needsRapComponentReview({from:ob,to:ne,cents:5000}),true);
 assert.equal(JSON.stringify(report).includes(ne),false);
});

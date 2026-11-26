import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRelatedRows,resolveRelatedDocuments,planRelatedDocuments} from '../src/cgu-related.mjs';
import {buildCommitmentTrajectories} from '../assets/trajectory.js';
import {buildIntegratedIndex,scopeFinancialEvidence,summarizeIntegratedCoverage} from '../assets/integrated-trajectory.js';
import {emptyMonth,mergeMonth,applyDocumentEnrichment,validateMonth} from '../src/store.mjs';
import {stateKey} from '../src/operational-state.mjs';
const ne='158459264222026NE000001',ns='158459264222026NS000002',ob='158459264222026OB000003';
const date='2026-05-01',now=new Date('2026-11-26T12:00:00Z');
const doc={id:ne,date,phase:1,cents:10000},liq={id:ns,date,phase:2,cents:9000},pay={id:ob,date,phase:3,cents:8000};
const month=(documents,relations=[])=>({unit:'158459',month:'2026-05',documents,relations});
test('aproveita somente identidade integral, nunca o valor documental, texto, NS->OB ou fora do recorte',async()=>{
 const rows=[{documento:ns,valor:'999,99',favorecido:'CPF 12345678901'},{documento:ob},{documento:ob},
  {documento:'158125264222026NS000002'},{documento:'2026NS000002'},{documento:'158459264222023NS000001'},{documento:ne}];
 const r=normalizeRelatedRows(ne,1,rows);
 assert.deepEqual(r.ids,[ns,ob].sort());assert.equal(r.excluded,4);
 assert.equal(JSON.stringify(r).includes('999,99'),false);
 assert.deepEqual(normalizeRelatedRows(ns,2,[{documento:ne},{documento:ob}]).ids,[ne]);
 assert.throws(()=>normalizeRelatedRows(ne,1,[{codigo:ns}]));
 assert.throws(()=>normalizeRelatedRows(ne,2,[]));
 const result=await resolveRelatedDocuments(doc,{token:'secret',request:async url=>{
  assert.equal(new URL(url).searchParams.get('codigoDocumento'),ne);
  return rows;
 }});assert.deepEqual(result,r);
});
test('persistencia idempotente, preserva valores e cobertura; reconsulta omissa nao apaga; merge diario preserva ids',()=>{
 const patch={documents:[doc],links:[],coverage:{date,phase:1,complete:true,count:1,invalid:0}};
 const old=mergeMonth(emptyMonth('2026-05'),'2026-05',[patch],now).data;
 const result=applyDocumentEnrichment(old,ne,{kind:'relatedDocuments',ids:[ns,ob]},now);
 assert.equal(result.changed,true);
 assert.deepEqual(result.data.documents[0].relatedIds,[ns,ob].sort());
 assert.deepEqual(result.data.relations,old.relations);assert.deepEqual(result.data.coverage,old.coverage);
 assert.equal(result.data.documents[0].cents,10000);
 assert.equal(applyDocumentEnrichment(result.data,ne,{kind:'relatedDocuments',ids:[ob,ns]},now).changed,false);
 assert.throws(()=>applyDocumentEnrichment(result.data,ne,{kind:'relatedDocuments',ids:[ns]},now));
 assert.throws(()=>applyDocumentEnrichment(old,ne,{kind:'relatedDocuments',ids:['158125264222026NS000002']},now));
 assert.deepEqual(mergeMonth(result.data,'2026-05',[patch],now).data.documents[0].relatedIds,[ns,ob].sort());
 assert.doesNotThrow(()=>validateMonth(result.data));
});
test('uniao nos dois sentidos, impacto prevalece, sem valor presumido ou dupla contagem',()=>{
 const months=[month([{...doc,relatedIds:[ns,ob]},{...liq,relatedIds:[ne]},{...pay,relatedIds:[ne]}],[{from:ns,to:ne,cents:2000}])];
 const e=buildCommitmentTrajectories(months)[0];
 assert.equal(e.links.length,2);assert.equal(e.liquidationCents,2000);assert.equal(e.paymentCents,null);
 assert.equal(e.paymentUnknown,1);assert.equal(e.liquidations[0].relatedCgu,true);
 assert.equal(e.payments[0].cents,null);
 const c={id:'c1',commitmentRefs:[ne]},i=buildIntegratedIndex({months,contracts:[c]});
 assert.equal(i.originsByDoc.get(ob)[0].entry.id,ne);
 const s=scopeFinancialEvidence(i,'instrument','c1');
 assert.equal(s.liquidation.cents,2000);assert.equal(s.payment.known,0);assert.equal(s.payment.unknown,1);
 const audit=summarizeIntegratedCoverage(i);
 assert.equal(audit.cguRelatedPairs,2);assert.equal(audit.cguRelatedOnlyPairs,1);
 const reverse=buildCommitmentTrajectories([month([{...pay,relatedIds:[ne]}])])[0];
 assert.equal(reverse.document,null);assert.equal(reverse.id,ne);assert.equal(reverse.paymentCents,null);
});
test('planejamento limitado, prioridade para NE declarada e inversa sem impacto, respeita checkpoint',()=>{
 const m=month([doc,liq,pay]);
 const plan=planRelatedDocuments([m],{contracts:[{commitmentRefs:[ne]}],now,limit:2});
 assert.equal(plan.length,2);assert.ok(plan.some(x=>x.doc.id===ne));assert.ok(plan.some(x=>x.doc.phase!==1));
 const state={[stateKey(['cgu-related-v1',ne,1,null])]:'2026-11-26'};
 assert.ok(planRelatedDocuments([m],{state,now,limit:3}).every(x=>x.doc.id!==ne));
 assert.equal(planRelatedDocuments([month([{...doc,id:'158459264222023NE000001'}])],{now}).length,0);
});

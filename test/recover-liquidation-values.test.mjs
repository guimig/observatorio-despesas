import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyMonth,mergeMonth,applyDocumentEnrichment,validateMonth} from '../src/store.mjs';
import {collectDayPhase} from '../src/cgu.mjs';
import {collectHistoricalDate,phasesMissingOnDate,safeFailureCategory} from '../src/historical-collector.mjs';
import {recoverLiquidationValues,canResumeLiquidations} from '../src/recover-liquidation-values.mjs';
const date='2026-10-16',br='16/10/2026',now=new Date('2026-11-24T21:00:00Z');
const ns='158459264222026NS000001',ns2='158459264222026NS000002',ne='158459264222026NE000001';
const patch={documents:[{id:ns,date,phase:2,cents:null},{id:ns2,date,phase:2,cents:null}],links:[],coverage:{date,phase:2,complete:true,count:2,invalid:2}};
const m=()=>mergeMonth(emptyMonth('2026-10'),'2026-10',[patch],now).data;
test('listagem completa pode ser recuperada sem consumir chamadas de impactos',async()=>{
 let calls=0;
 const row={documento:ns,codigoUg:'158459',valor:null};
 const p=await collectDayPhase(br,2,{token:'test',deferLiquidationValues:true,
 getDocuments:async(_d,_p,page)=>page===1?[row]:[],getImpacts:async()=>{calls++;throw Error('nao consultar')}});
 assert.equal(p.coverage.complete,true);assert.equal(p.coverage.invalid,1);assert.equal(calls,0);
});
test('retomada recupera apenas lacunas, preserva valores e reduz invalid sem alterar listagem',async()=>{
 const first=m(),saved=[];
 assert.equal(canResumeLiquidations(first,date),true);
 assert.deepEqual(phasesMissingOnDate(first,br,{listingOnly:true}),[1,3]);
 assert.deepEqual(phasesMissingOnDate(first,br),[1,2,3]);
 const resolve=async id=>({cents:100,links:[{from:id,to:ne,cents:100}],unlinked:0});
 const a=await recoverLiquidationValues(first,date,{limit:1,now,resolve,persist:async(id,r)=>saved.push(id)});
 assert.equal(a.summary.recovered,1);assert.equal(a.data.coverage[0].invalid,1);
 assert.equal(a.data.documents[0].valueSource,'impactos_cgu');
 const b=await recoverLiquidationValues(a.data,date,{limit:1,now,resolve,persist:async(id,r)=>saved.push(id)});
 assert.equal(b.summary.recovered,1);assert.equal(b.data.coverage[0].invalid,0);
 assert.deepEqual(saved,[ns,ns2]);assert.equal(b.data.relations.length,2);assert.doesNotThrow(()=>validateMonth(b.data));
 assert.equal(applyDocumentEnrichment(b.data,ns,{kind:'liquidationValue',cents:101,links:[{from:ns,to:ne,cents:101}]},now).changed,false);
});
test('resposta vazia ou impacto sem identificacao nao preenche valor',async()=>{
 const a=await recoverLiquidationValues(m(),date,{now,resolve:async()=>({cents:null,links:[]})});
 assert.equal(a.summary.recovered,0);assert.equal(a.data.coverage[0].invalid,2);
 const b=await recoverLiquidationValues(m(),date,{now,resolve:async id=>({cents:100,links:[{from:id,to:ne,cents:90}],unlinked:1})});
 assert.equal(b.summary.recovered,0);assert.equal(b.summary.unresolved,2);
 assert.throws(()=>applyDocumentEnrichment(m(),ns,{kind:'liquidationValue',cents:100,links:[{from:ns,to:ne,cents:90}]},now));
});
test('limite operacional nao e falha de fonte; fases nao iniciadas ficam pendentes',async()=>{
 let calls=0;
 const r=await collectHistoricalDate({date:br,existing:m(),listingOnly:true,collect:async(_,phase)=>{
  calls++;throw Object.assign(Error('limite'),{code:'CGU_BUDGET_STOP'});
 },persist:async()=>{throw Error('nao gravar')}});
 assert.equal(calls,1);assert.equal(r.failed,0);assert.equal(r.deferred,2);assert.equal(r.fullyComplete,false);
 assert.equal(safeFailureCategory({code:'CGU_BUDGET_STOP'}),'budget_deferred');
});

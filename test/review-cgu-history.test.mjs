import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planHistoricalReviews,prepareHistoricalReview,phaseKey,reviewHistoricalCgu} from '../src/review-cgu-history.mjs';
import {mergeMonth,emptyMonth,persistWindow,validatePublishedData} from '../src/store.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const now=new Date('2026-11-24T16:00:00Z'),date='2024-01-02',id='158459264222024NE000001';
const ne={id,date,phase:1,cents:100};
const patch=(docs=[ne])=>({documents:docs,links:[],coverage:{date,phase:1,complete:true,count:docs.length,invalid:0}});
const m=mergeMonth(emptyMonth('2024-01'),'2024-01',[patch()],now).data;
test('prioriza NE antiga com impacto recente, preserva recorte e respeita intervalo',()=>{
 const ns={id:'158459264222026NS000001',date:'2026-11-20',phase:2,cents:50};
 const next={month:'2026-11',documents:[ns],relations:[{from:ns.id,to:id,cents:50}],coverage:[]};
 const outside={month:'2023-12',documents:[],relations:[],coverage:[{date:'2023-12-01',phase:1,complete:true,invalid:0}]};
 const selected=planHistoricalReviews([m,next,outside],{now});
 assert.equal(selected.eligible,1);assert.equal(selected.active,1);assert.equal(selected.selected[0].date,date);
 assert.equal(planHistoricalReviews([m,next],{now,state:{[phaseKey(date,1)]:'2026-11-23'}}).eligible,0);
 assert.equal(planHistoricalReviews([m,next],{now,state:{[phaseKey(date,1)]:'2026-11-19'}}).eligible,1);
});
test('revisao recusa vazio conflitante, data divergente e parcial; aceita variacao de um centavo',()=>{
 const task={date,phase:1};
 assert.equal(prepareHistoricalReview(m,task,patch([])).reason,'missing_confirmed_document');
 const incomplete=patch();incomplete.coverage.complete=false;
 assert.equal(prepareHistoricalReview(m,task,incomplete).reason,'incomplete');
 assert.equal(prepareHistoricalReview(m,task,patch([{...ne,cents:101}]),new Map([[id,'2024-01-03']])).reason,'identity_or_date_conflict');
 const good=prepareHistoricalReview(m,task,patch([{...ne,cents:101}]));
 assert.equal(good.ok,true);
 assert.equal(mergeMonth(m,'2024-01',[good.patch],now).data.documents[0].cents,101);
});
test('reconsulta identica nao regrava dados e cache impede repeticao; mudanca financeira e aplicada',async()=>{
 const root=await mkdtemp(join(tmpdir(),'review-cgu-'));
 const statePath=join(root,'state.json');
 try{
  await persistWindow(root,[patch()],new Date('2026-11-01'));
  const file=join(root,'data/months/2024-01.json'),before=await readFile(file,'utf8');
  let calls=0;
  const options={root,token:'test',now,statePath,collect:async()=>{calls++;return patch()}};
  const first=await reviewHistoricalCgu(options);
  assert.equal(first.completed,1);assert.equal(first.changedPhases,0);
  assert.equal(await readFile(file,'utf8'),before);
  assert.equal((await reviewHistoricalCgu(options)).planned,0);assert.equal(calls,1);
  const changed=await reviewHistoricalCgu({...options,statePath:undefined,collect:async()=>patch([{...ne,cents:101}])});
  assert.equal(changed.changedPhases,1);
  assert.equal((await validatePublishedData(root)).months[0].documents[0].cents,101);
 }finally{await rm(root,{recursive:true,force:true})}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCguBudget} from '../src/cgu-budget.mjs';
import {getCguArray} from '../src/cgu.mjs';
import {planAdaptiveBackfill} from '../src/backfill-adaptive.mjs';
test('limite conta chamadas reais, inclusive novas tentativas, e controla intervalo',async()=>{
 let now=0;const budget=createCguBudget({requests:2,clock:()=>now,sleep:async ms=>{now+=ms}});
 let calls=0;
 await getCguArray('https://example.invalid',{token:'test',budget,fetcher:async()=>{
  calls++;return calls===1?new Response('',{status:503}):Response.json([]);
 },wait:async()=>{}});
 assert.equal(calls,2);assert.equal(now,1500);
 assert.equal(budget.snapshot().stopReason,'request_budget');
 await assert.rejects(getCguArray('https://example.invalid',{token:'test',budget,fetcher:async()=>{calls++;return Response.json([])}}));
 assert.equal(calls,2);
});
test('429 interrompe imediatamente sem novas chamadas, mesmo com orcamento disponivel',async()=>{
 const budget=createCguBudget({spacingMs:0});
 let calls=0;
 await assert.rejects(getCguArray('https://example.invalid',{token:'test',budget,fetcher:async()=>{calls++;return new Response('',{status:429})},wait:async()=>{throw Error('nao aguardar')}}),{status:429});
 assert.equal(calls,1);assert.equal(budget.snapshot().stopReason,'http_429');
});
test('deadline e falhas consecutivas encerram lote',async()=>{
 let now=0;const b=createCguBudget({durationMs:5,clock:()=>now,spacingMs:0});
 await b.beforeRequest();now=6;await assert.rejects(b.beforeRequest());
 assert.equal(b.snapshot().stopReason,'time_budget');
 const c=createCguBudget({spacingMs:0});c.observe(503);c.observe(null);c.observe(500);
 assert.equal(c.snapshot().stopReason,'source_unstable');
});
test('planejamento adaptativo cobre varios meses sem repetir dias nem sair do recorte',async()=>{
 const now=new Date('2024-04-10T12:00:00Z');
 const full=Array.from({length:31},(_,i)=>[1,2,3].map(phase=>({date:'2024-01-'+String(i+1).padStart(2,'0'),phase,complete:true,invalid:0}))).flat();
 const {tasks,eligibleMonths}=await planAdaptiveBackfill({now,slot:0,maxDays:12,
  loadExisting:async month=>month==='2024-01'?{month,coverage:full}:null});
 assert.equal(eligibleMonths,3);assert.equal(tasks.length,12);
 assert.equal(new Set(tasks.map(x=>x.date)).size,12);
 assert.equal(new Set(tasks.map(x=>x.month)).size,3);
 assert.ok(tasks.every(x=>x.month>='2024-02'&&x.month<='2024-04'));
});
test('lote reserva vagas para dia parcial e competencia sem arquivo antes das demais datas',async()=>{
 const now=new Date('2024-03-10T12:00:00Z');
 const january={month:'2024-01',coverage:[
  ...[1,2,3].map(phase=>({date:'2024-01-01',phase,complete:true,invalid:0})),
  {date:'2024-01-30',phase:2,complete:true,invalid:1}
 ]};
 const options={now,slot:0,maxDays:5,loadExisting:async month=>month===january.month?january:null,
  priorityDates:['2024-01-30','2024-03-05'],prioritize:true,priorityYears:['2024']};
 const {tasks}=await planAdaptiveBackfill(options);
 assert.deepEqual(tasks.slice(0,3),[
  {month:'2024-01',date:'30/01/2024'},
  {month:'2024-02',date:'01/02/2024'},
  {month:'2024-03',date:'05/03/2024'}
 ]);
 assert.equal(new Set(tasks.map(task=>task.date)).size,5);
 assert.ok(tasks.every(task=>task.date!=='01/01/2024'));
 const small=await planAdaptiveBackfill({...options,slot:1,maxDays:1});
 assert.deepEqual(small.tasks,[{month:'2024-02',date:'02/02/2024'}]);
});

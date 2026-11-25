import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectionLimits,createCguBudget,BACKFILL_LIMITS,INTENSIVE_LIMITS,HISTORICAL_INTENSIVE_LIMITS} from '../src/cgu-budget.mjs';
import {planAdaptiveBackfill} from '../src/backfill-adaptive.mjs';
import {chooseNeBatch,fetchCguOriginal} from '../src/recover-cgu-originals.mjs';
import {planItemResults} from '../src/pncp-item-results.mjs';
test('passivo alto amplia orcamento, passivo baixo ou manual usa limite normal',()=>{
 assert.equal(collectionLimits({intensive:true,backlog:22}).requests,240);
 assert.equal(collectionLimits({intensive:true,backlog:21}).requests,120);
 assert.equal(collectionLimits({intensive:false,backlog:100}).requests,120);
 assert.equal(INTENSIVE_LIMITS.spacingMs,BACKFILL_LIMITS.spacingMs);
 assert.equal(INTENSIVE_LIMITS.durationMs,BACKFILL_LIMITS.durationMs);
 assert.throws(()=>createCguBudget({requests:361}));
 assert.doesNotThrow(()=>createCguBudget(INTENSIVE_LIMITS));
});
test('rodada histórica intensiva planeja 63 dias distintos dentro do recorte',async()=>{
 const p=await planAdaptiveBackfill({now:new Date('2025-01-01T12:00:00Z'),slot:0,maxDays:HISTORICAL_INTENSIVE_LIMITS.days});
 assert.equal(p.tasks.length,63);
 assert.equal(new Set(p.tasks.map(t=>t.date)).size,63);
 assert.ok(p.tasks.every(t=>t.month>='2024-01'));
});
test('orçamento histórico ampliado mantém intervalo e bloqueio imediato',async()=>{
 let now=0;
 const limits=HISTORICAL_INTENSIVE_LIMITS;
 assert.equal(limits.spacingMs,1500);
 const options={...limits,clock:()=>now,sleep:async ms=>{now+=ms}};
 const budget=createCguBudget(options);
 for(let n=0;n<360;n++){await budget.beforeRequest();budget.observe(200);}
 assert.equal(now,359*1500);
 await assert.rejects(budget.beforeRequest(),{code:'CGU_BUDGET_STOP'});
 assert.equal(budget.snapshot().stopReason,'request_budget');
 const blocked=createCguBudget(options);
 await blocked.beforeRequest();
 blocked.observe(429);
 await assert.rejects(blocked.beforeRequest(),{code:'CGU_BUDGET_STOP'});
 assert.equal(blocked.snapshot().requests,1);
});
test('origens ate quinze e parada imediata de 429 na consulta individual',async()=>{
 const ids=Array.from({length:16},(_,i)=>'158459264222024NE'+String(i+1).padStart(6,'0'));
 assert.equal(chooseNeBatch(ids,{limit:15}).length,15);
 let calls=0;
 const budget=createCguBudget({requests:30,spacingMs:0});
 await assert.rejects(fetchCguOriginal(ids[0],{token:'test',budget,fetchFn:async()=>{calls++;return new Response('',{status:429})},wait:async()=>{throw Error('nao repetir')}}),{status:429});
 assert.equal(calls,1);assert.equal(budget.snapshot().stopReason,'http_429');
});
test('resultados PNCP aceitam sessenta consultas sem duplicar item',()=>{
 const pncpId='10635424000186-1-000001/2026';
 const items=Array.from({length:100},(_,i)=>({pncpId,number:i+1,quantity:1,description:'item'}));
 const plan=planItemResults([{pncpId,items}],{limit:60,slot:0});
 assert.equal(plan.length,60);assert.equal(new Set(plan.map(i=>i.number)).size,60);
 assert.throws(()=>planItemResults([{pncpId,items}],{limit:61,slot:0}));
});

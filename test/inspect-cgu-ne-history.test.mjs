import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planHistoricalNeProbes,pickHistoricalItems,auditHistoricalNe,
 summarizeNeAudits} from '../src/inspect-cgu-ne-history.mjs';

const prefix='15845926422';
const old=prefix+'2025NE000109',old2=prefix+'2024NE000117';
const current=prefix+'2026NE000111';
const ns=prefix+'2026NS000001',ob=prefix+'2026OB000002';
const fixture={month:'2026-11',data:{
 documents:[{id:old,date:'2025-12-10',phase:1},
  {id:current,date:'2026-11-10',phase:1},
  {id:ns,date:'2026-11-12',phase:2},
  {id:ob,date:'2026-11-13',phase:3}],
 relations:[{from:ns,to:old},{from:ob,to:old},{from:ns,to:old2},
  {from:ob,to:current}]}};
test('planejamento seleciona NEs reais relacionadas a documentos posteriores e controles, sem duplicar',()=>{
 const plan=planHistoricalNeProbes([fixture],{max:10});
 assert.equal(new Set(plan.map(x=>x.id)).size,plan.length);
 assert.ok(plan.some(x=>x.id===old&&x.cohort==='cross_year_payment'));
 assert.ok(plan.some(x=>x.id===old2&&x.cohort==='cross_year_liquidation'));
 assert.ok(plan.some(x=>x.id===current&&x.cohort==='current_control'));
 assert.throws(()=>planHistoricalNeProbes([fixture],{max:21}));
 assert.throws(()=>planHistoricalNeProbes([{month:'2026-11',data:{}}]));
});
test('amostragem nao trata NS do mesmo ano como evidencia interanual',()=>{
 const same={month:'2026-11',data:{documents:[{id:ns,phase:2}],
 relations:[{from:ns,to:current}]}};
 const planned=planHistoricalNeProbes([same]);
 assert.equal(planned.length,0);
});
test('seleciona itens nulos, inicial e final sem repetir nem exceder limite',()=>{
 const items=Array.from({length:8},(_,i)=>({seq:i+1,cents:i===3?0:100}));
 assert.deepEqual(pickHistoricalItems(items,{max:3}).map(x=>x.seq),[4,1,8]);
 assert.throws(()=>pickHistoricalItems([{seq:1},{seq:1}]));
});
test('classifica cancelamento posterior e preserva operacoes sem calcular saldo',async()=>{
 const sample={id:old,year:2025,cohort:'cross_year_payment'};
 const audit=await auditHistoricalNe(sample,{token:'FAKE',
   resolveItemsFn:async()=>({ok:true,items:[{seq:1,cents:0},{seq:2,cents:12}]}),
   resolveHistoryFn:async(id,seq)=>{
     assert.equal(id,old);
     return {ok:true,movements:seq===1?[
       {date:'2025-12-10',type:'original',cents:100},
       {date:'2026-03-10',type:'cancellation',cents:20},
       {date:'2026-04-12',type:'reversal',cents:20}
     ]:[{date:'2025-12-11',type:'annulment',cents:100}]};
   }});
 assert.equal(audit.status,'complete');
 assert.equal(audit.historiesCompleted,2);
 assert.equal(audit.movements.cancellation,1);
 assert.equal(audit.movements.reversal,1);
 assert.equal(audit.cancellationDates.later,1);
 assert.equal(audit.cancellationItems,1);
 const output=summarizeNeAudits([audit]);
 assert.equal(output.cohorts.cross_year_payment.movements.cancellation,1);
 assert.equal(JSON.stringify(output).includes(old),false);
 assert.equal(JSON.stringify(output).includes('FAKE'),false);
});
test('erro de fonte, historico sem linhas e consulta parcial nao viram ausencia de movimento',async()=>{
 const sample={id:old,year:2025,cohort:'older_origin'};
 const empty=await auditHistoricalNe(sample,{token:'FAKE',
   resolveItemsFn:async()=>({ok:true,items:[]})});
 assert.equal(empty.status,'no_items');
 const fail=await auditHistoricalNe(sample,{token:'FAKE',
   resolveItemsFn:async()=>{throw Error('CPF 000.111.222-33');}});
 assert.equal(fail.status,'items_unavailable');
 assert.equal(JSON.stringify(fail).includes('CPF'),false);
 const partial=await auditHistoricalNe(sample,{token:'FAKE',
   resolveItemsFn:async()=>({ok:true,items:[{seq:1},{seq:2}]}),
   resolveHistoryFn:async(_,seq)=>seq===1?{ok:true,movements:[]}:
     {ok:false,reason:'consulta_indisponivel'}});
 assert.equal(partial.status,'partial');
 assert.equal(partial.historiesCompleted,1);
 assert.equal(partial.historiesUnavailable,1);
 assert.equal(partial.movements.cancellation,0);
 const malformed=await auditHistoricalNe(sample,{token:'FAKE',
   resolveItemsFn:async()=>({ok:true,items:[{seq:1}]}),
   resolveHistoryFn:async()=>({ok:false,reason:'TOKEN_FORBIDDEN'})});
 assert.equal(JSON.stringify(malformed).includes('TOKEN_FORBIDDEN'),false);
});
test('acervo da main possui notas anteriores que podem entrar na amostragem',async()=>{
 const data=JSON.parse(await readFile(new URL('../data/months/2025-12.json',import.meta.url),'utf8'));
 const newer=JSON.parse(await readFile(new URL('../data/months/2026-11.json',import.meta.url),'utf8'));
 const rows=planHistoricalNeProbes([{month:'2026-11',data:newer},{month:'2025-12',data}],{max:14});
 assert.ok(rows.some(x=>x.year===2025));
 assert.ok(rows.every(x=>x.id.startsWith(prefix)));
});

test('janelas deterministicas alternam NEs sem repeti-las na mesma consulta',()=>{
 const docs=Array.from({length:18},(_,i)=>({
   id:prefix+'2025NE'+String(i+1).padStart(6,'0'),phase:1}));
 const source={month:'2026-11',data:{documents:docs,relations:[]}};
 const a=planHistoricalNeProbes([source],{max:4,window:0});
 const b=planHistoricalNeProbes([source],{max:4,window:1});
 assert.equal(a.length,4);
 assert.equal(b.length,4);
 assert.notDeepEqual(a.map(x=>x.id),b.map(x=>x.id));
 assert.deepEqual(b,planHistoricalNeProbes([source],{max:4,window:1}));
 assert.equal(new Set(b.map(x=>x.id)).size,4);
 assert.throws(()=>planHistoricalNeProbes([source],{window:-1}));
});
test('ano de controle deriva dos meses consultados em vez de ano fixo',()=>{
 const source={month:'2027-01',data:{documents:[
  {id:prefix+'2027NE000001',phase:1},
  {id:prefix+'2026NE000001',phase:1}],relations:[]}};
 const plan=planHistoricalNeProbes([source],{max:5});
 assert.equal(plan.find(x=>x.year===2027)?.cohort,'current_control');
 assert.equal(plan.find(x=>x.year===2026)?.cohort,'older_origin');
});
test('historicos somente amostrados nao equivalem a cobertura total da NE',async()=>{
 const sample={id:old,year:2025,cohort:'older_origin'};
 const audit=await auditHistoricalNe(sample,{token:'FAKE',
   resolveItemsFn:async()=>({ok:true,items:[
    {seq:1,cents:100},{seq:2,cents:100},{seq:3,cents:100},{seq:4,cents:100}]}),
   resolveHistoryFn:async()=>({ok:true,movements:[
    {date:'2025-01-01',type:'other',operation:'Baixa de registro'},
    {date:'2026-01-01',type:'other',operation:'Reinscrição'},
    {date:'unexpected',type:'other',operation:'Movimento desconhecido'}]}),
   maxItems:3});
 assert.equal(audit.status,'sampled_only');
 assert.equal(audit.itemsSampled,3);
 assert.equal(audit.itemsNotSampled,1);
 assert.equal(audit.otherDates.same,3);
 assert.equal(audit.otherDates.later,3);
 assert.equal(audit.otherDates.invalid,3);
 assert.equal(audit.otherHints.baixa,3);
 assert.equal(audit.otherHints.reinscricao,3);
 assert.equal(audit.otherHints.sem_pista,3);
 const summary=summarizeNeAudits([audit]);
 assert.equal(summary.cohorts.older_origin.status.sampled_only,1);
 assert.equal(summary.cohorts.older_origin.itemsNotSampled,1);
 assert.equal(JSON.stringify(summary).includes(old),false);
});

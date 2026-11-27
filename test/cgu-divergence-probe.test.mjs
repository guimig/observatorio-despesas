import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexCommitmentChronology} from '../assets/siafi-movement-reconciliation.js';
import {createCguBudget} from '../src/cgu-budget.mjs';
import {divergenceProbeKey,compareDivergentTimeline,planDivergenceProbes,createDivergenceProbeBudget,
 inspectDivergentRecord,runDivergenceProbes} from '../src/cgu-divergence-probe.mjs';

const now=new Date('2026-11-27T17:00:00Z'),today='2026-11-27';
const id=(n,year=2026)=>'15845900001'+year+'NE'+String(n).padStart(6,'0');
const event=(date,type,cents)=>({date,type,cents});
const original=event('2026-01-10','original',100),reinforcement=event('2026-03-10','reinforcement',100);
const item=(seq=1,cents=200,movements=[original,reinforcement])=>({seq,cents,historyChecked:true,movements});
const doc=(n,extra={})=>({id:id(n),phase:1,date:'2026-01-10',cents:100,itemsDetailVersion:2,...extra});
const month=(docs,items,observations=[])=>({month:'2026-01',documents:docs,
 itemsByDocument:items,commitmentObservations:observations});
const fixture=(n=1,items=[item()],extra={})=>month([doc(n,extra)],{[extra.id||id(n)]:items});
const record=m=>indexCommitmentChronology([m]).entries[0];
const detail=(id,valor='2,00',extra={})=>({documento:id,codigoUg:'158459',fase:'Empenho',data:'2026-01-10',valor,...extra});
const localBudget=()=>createCguBudget({requests:120,durationMs:480000,spacingMs:0});

test('historicos completos suportam padrao temporal mas nao alteram evidencia original',()=>{
 const r=record(fixture());
 const before=JSON.stringify(r);
 const result=compareDivergentTimeline(r,r.owners[0].items,{today});
 assert.deepEqual(result,{history:'reconciled_to_catalog',timeline:'reference_matches_reconstruction_at_listing'});
 assert.equal(JSON.stringify(r),before);
 const other=record(fixture(1,[item()],{cents:150}));
 assert.equal(compareDivergentTimeline(other,other.owners[0].items,{today}).timeline,'reference_differs_from_reconstruction_at_listing');
});
test('nao extrapola amostra nem usa movimentos fora do recorte ou ambiguos',()=>{
 const r=record(fixture());
 assert.equal(compareDivergentTimeline(r,[{seq:1,cents:200,historyChecked:false}],{today}).timeline,'not_comparable');
 assert.equal(compareDivergentTimeline(r,[item(1,200,[original,event('2027-01-01','reinforcement',100)])],{today}).history,'outside_window');
 assert.equal(compareDivergentTimeline(r,[item(1,200,[original,event('2026-02-01','other',100)])],{today}).history,'unavailable');
 assert.equal(compareDivergentTimeline(r,[item(1,300)],{today}).history,'divergent_from_catalog');
 assert.equal(compareDivergentTimeline(r,[item(1,200,[event('2026-01-10','original',200)])],{today}).timeline,'no_later_movements');
});
test('planejamento respeita recorte, identidade unica, cache, exclusao e prioridade contratual',()=>{
 const a=month([doc(1),doc(2),doc(3),doc(4),doc(5,{id:id(5,2023)})],
  Object.fromEntries([1,2,3,4].map(n=>[id(n),[item()]]).concat([[id(5,2023),[item()]]])));
 const r=indexCommitmentChronology([a]).entries.find(x=>x.id===id(2));
 const key=divergenceProbeKey(r,'complete');
 const p=planDivergenceProbes([a],{now,today,state:{[key]:'2026-11-25'},excludeIds:[id(1)],cguContracts:[{refs:[id(4)]}]});
 assert.equal(p.summary.divergent,4);
 assert.equal(p.summary.deferred,1);assert.equal(p.summary.scheduledElsewhere,1);
 assert.equal(p.selected.length,2);assert.equal(p.selected[0].record.id,id(4));
 assert.equal(p.summary.stored.timeline.reference_matches_reconstruction_at_listing,4);
 assert.ok(!JSON.stringify(p.summary).includes(id(4)));
 const updated=month([doc(2)],{[id(2)]:[item(1,300,[original,event('2026-04-01','reinforcement',200)])]});
 assert.equal(planDivergenceProbes([updated],{now,today,state:{[key]:'2026-11-25'}}).selected.length,1);
});
test('sondagem compara detalhe atual, catalogo e historicos sem registrar valores',async()=>{
 const r=record(fixture());
 const args={token:'SECRET',now,today,
  requestDetail:async d=>detail(d,'2,00',{observacao:'CPF 000.123.456-78'}),
  requestItems:async()=>({ok:true,items:[{seq:1,cents:200}]}),
  requestHistory:async()=>({ok:true,movements:[original,reinforcement]})};
 const p=await inspectDivergentRecord(r,args);
 assert.equal(p.pattern,'temporal_pattern_supported');
 assert.equal(p.detailRelation,'matches_fresh_catalog_only');
 assert.equal(p.fullyQueried,true);
 assert.ok(!JSON.stringify(p).includes(id(1)));
 assert.ok(!JSON.stringify(p).includes('000.123.456-78'));
 assert.ok(!JSON.stringify(p).includes('SECRET'));
 const d=await inspectDivergentRecord(r,{...args,requestDetail:async id=>detail(id,'1,00')});
 assert.equal(d.pattern,'document_and_catalog_remain_different');
 const e=await inspectDivergentRecord(r,{...args,requestDetail:async id=>detail(id,'1,00'),
  requestItems:async()=>({ok:true,items:[{seq:1,cents:100}]}),
  requestHistory:async()=>({ok:true,movements:[original]})});
 assert.equal(e.pattern,'current_sources_match_reference');
});
test('respostas invalidas, identidade divergente e historicos incompletos nao confirmam hipotese',async()=>{
 const r=record(fixture());
 const args={token:'SECRET',now,today,requestDetail:async d=>detail(d),
  requestItems:async()=>({ok:true,items:[{seq:1,cents:100},{seq:2,cents:100}]}),
  requestHistory:async()=>({ok:true,movements:[original]}),maxItems:1};
 const partial=await inspectDivergentRecord(r,args);
 assert.equal(partial.history,'partial');assert.equal(partial.fullyQueried,false);
 assert.equal(partial.pattern,'unresolved');
 const bad=await inspectDivergentRecord(r,{...args,requestDetail:async()=>detail(id(2)),
  requestItems:async()=>{throw Error('nao deve consultar')}});
 assert.equal(bad.detail,'identity_unverified');assert.equal(bad.catalog,'not_checked');
 const duplicate=await inspectDivergentRecord(r,{...args,requestItems:async()=>({ok:true,items:[{seq:1,cents:100},{seq:1,cents:100}]})});
 assert.equal(duplicate.catalog,'invalid');assert.equal(duplicate.pattern,'unresolved');
 const unavailable=await inspectDivergentRecord(r,{...args,requestDetail:async()=>{throw Error('PRIVATE')}})
 assert.equal(unavailable.detail,'unavailable');assert.equal(unavailable.pattern,'unresolved');
});
test('suborcamento limita somente a sondagem e propaga restricoes da fonte',async()=>{
 const parent=localBudget(),child=createDivergenceProbeBudget(parent,{requests:2,durationMs:10000});
 await child.beforeRequest();child.observe(200);await child.beforeRequest();child.observe(200);
 assert.equal(child.stopped(),'probe_request_limit');assert.equal(parent.stopped(),null);
 await assert.rejects(child.beforeRequest(),{code:'CGU_BUDGET_STOP'});
 await parent.beforeRequest();parent.observe(200);
 assert.equal(parent.snapshot().requests,3);
 const other=localBudget(),restricted=createDivergenceProbeBudget(other,{requests:2,durationMs:10000});
 await restricted.beforeRequest();restricted.observe(429);
 assert.equal(other.stopped(),'http_429');assert.equal(restricted.stopped(),'http_429');
});
test('execucao gera contagens e checkpoints sem persistir documentos nem ampliar o orcamento',async()=>{
 const m=month([doc(1),doc(2)],{[id(1)]:[item()],[id(2)]:[item()]}),state={};
 const plan=planDivergenceProbes([m],{now,today});
 const parent=localBudget();
 const call=async (budget,value)=>{await budget.beforeRequest();budget.observe(200);return value};
 const result=await runDivergenceProbes(plan,{token:'SECRET',parent,limits:{requests:120,durationMs:480000},
  state,now,today,requestDetail:(id,{budget})=>call(budget,detail(id)),
  requestItems:(id,{budget})=>call(budget,{ok:true,items:[{seq:1,cents:200}]}),
  requestHistory:(id,seq,{budget})=>call(budget,{ok:true,movements:[original,reinforcement]})});
 assert.equal(result.attempted,2);assert.equal(result.fullyQueried,2);
 assert.equal(result.pattern.temporal_pattern_supported,2);
 assert.equal(result.requests,6);assert.equal(parent.snapshot().requests,6);
 assert.equal(planDivergenceProbes([m],{now,today,state}).summary.deferred,2);
 assert.ok(Object.keys(state).every(k=>/^[a-f0-9]{64}$/.test(k)));
 assert.ok(!JSON.stringify(result).includes(id(1)));
 assert.ok(!JSON.stringify(state).includes(id(1)));
});

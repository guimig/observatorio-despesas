import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planEnrichmentAcrossMonths,planDetailRechecks,detailKey} from '../src/enrich-month.mjs';
import {mergeMonth,emptyMonth,applyDocumentEnrichment} from '../src/store.mjs';
import {planAdaptiveBackfill} from '../src/backfill-adaptive.mjs';
import {resolvePaymentLinks} from '../src/enrich-cgu.mjs';
const now=new Date('2026-11-24T15:00:00Z');
const m=(month,phase,id,cents=100)=>mergeMonth(emptyMonth(month),month,[{documents:[{id,date:month+'-01',phase,cents}],links:[],coverage:{date:month+'-01',phase,complete:true,count:1,invalid:0}}],now).data;
const ns='158459264222024NS000001',ob='158459264222025OB000001',ne='158459264222024NE000001';
test('distribui cotas globais entre meses e alterna tipos de enriquecimento',()=>{
 const a=m('2024-01',2,ns),b=m('2025-01',3,ob),c=m('2024-02',1,ne);
 const plan=planEnrichmentAcrossMonths([a,b,c],{now,slot:0,maxLiquidations:1,maxPayments:1,maxItems:1});
 assert.deepEqual(plan.map(x=>x.kind),['liquidation','payment','items']);
 assert.equal(new Set(plan.map(x=>x.month)).size,3);
});
test('vinculos confirmados retornam a fila apos 30 dias, cache depende dos centavos',()=>{
 const a=m('2024-01',2,ns);
 const checked=applyDocumentEnrichment(a,ns,{kind:'liquidation',links:[{from:ns,to:ne,cents:100}]},now).data;
 const key=detailKey(checked,ns,'liquidation');
 assert.equal(planDetailRechecks(checked,{now}).liquidation.length,1);
 assert.equal(planDetailRechecks(checked,{now,state:{[key]:'2026-11-23'}}).liquidation.length,0);
 assert.equal(planDetailRechecks(checked,{now,state:{[key]:'2026-10-01'}}).liquidation.length,1);
 assert.equal(planEnrichmentAcrossMonths([checked],{now,historyState:{[key]:'2026-11-23'}},{review:true}).length,0);
 assert.equal(applyDocumentEnrichment(checked,ns,{kind:'liquidation',links:[{from:ns,to:ne,cents:100}]},now).changed,false);
 const b=structuredClone(checked);b.documents[0].cents++;
 assert.notEqual(detailKey(b,ns,'liquidation'),key);
});
test('pagamento confirmado nao perde relacoes por resposta vazia e item nao perde sequencial por reconsulta',()=>{
 const b=m('2025-01',3,ob);
 const checked=applyDocumentEnrichment(b,ob,{kind:'payment',links:[{from:ob,to:ne,cents:100}]},now).data;
 assert.throws(()=>applyDocumentEnrichment(checked,ob,{kind:'payment',links:[]},now));
 const a=m('2024-01',1,ne);
 const detail=applyDocumentEnrichment(a,ne,{kind:'items',items:[{seq:1,cents:100}]},now).data;
 assert.throws(()=>applyDocumentEnrichment(detail,ne,{kind:'items',items:[],recheck:true},now));
 assert.equal(applyDocumentEnrichment(detail,ne,{kind:'items',items:[{seq:1,cents:101}],recheck:true},now).data.itemsByDocument[ne][0].cents,101);
});
test('orcamento e repassado a paginacao dos impactos',async()=>{
 const budget={};let calls=0;
 const r=await resolvePaymentLinks(ob,{token:'test',budget,request:async(id,page,opts)=>{calls++;assert.equal(opts.budget,budget);return []}});
 assert.equal(r.ok,true);assert.equal(calls,1);
});
test('backfill prioriza lacunas da issue, ignora dia completo e nao duplica tarefas',async()=>{
 const complete={month:'2026-10',coverage:[1,2,3].map(phase=>({date:'2026-10-14',phase,complete:true,invalid:0}))};
 const plan=await planAdaptiveBackfill({now,slot:0,maxDays:5,priorityDates:['2026-10-14','2026-10-15','2026-10-16','2023-12-31'],loadExisting:async m=>m==='2026-10'?complete:null});
 assert.deepEqual(plan.tasks.slice(0,2).map(t=>t.date),['15/10/2026','16/10/2026']);
 assert.equal(new Set(plan.tasks.map(t=>t.date)).size,plan.tasks.length);
 assert.ok(!plan.tasks.some(t=>t.date==='14/10/2026'||t.date==='31/12/2023'));
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCsvPlan,auditCsvTargets,planConfirmedCsvRecovery} from '../src/audit-rap-csv-targets.mjs';
import {emptyMonth,applyDocumentEnrichment,validateMonth} from '../src/store.mjs';
const ne='158459264222025NE000001',ob='158459264222026OB000001';
const event={date:'2026-01-10',operation:'inscricao em rp',quantity:'1.00',unitPrice:'100.000',cents:10000,count:2};
const components={paidCents:0,liquidatedCents:null,rpInscribedCents:0,rpCancelledCents:null,rpPaidCents:10000};
const fixture=()=>({version:1,histories:[{id:ne,seq:1,events:[{...event}]}],impacts:[{id:ob,ne,phase:3,components:{...components}}]});
test('confronto preserva multiplicidade, normaliza somente decimais e distingue campo ausente',async()=>{
 const fresh={...event,operation:'INSCRIÇÃO EM RP',quantity:'1',unitPrice:'100'};
 const result=await auditCsvTargets(fixture(),{
  historyResolver:async()=>({ok:true,movements:[fresh,fresh]}),
  paymentResolver:async()=>({ok:true,links:[{from:ob,to:ne,cents:10000,impactComponents:{...components,rpCancelledCents:0,repeatedRows:0}}]})
 });
 assert.equal(result.history.sameMultiset,1);assert.equal(result.history.origin2025Confirmed,1);
 assert.equal(result.impacts.allComparableFieldsEqual,1);assert.equal(result.impacts.fields.rpPaidCents.equal,1);
 assert.equal(result.impacts.fields.rpCancelledCents.equal,0);assert.ok(!JSON.stringify(result).includes(ne));
});
test('multiplicidade e divergência não são transformadas em saldo; resposta vazia não é zero',async()=>{
 const r=await auditCsvTargets(fixture(),{historyResolver:async()=>({ok:true,movements:[event]}),
  paymentResolver:async()=>({ok:true,links:[]})});
 assert.equal(r.history.differentMultiplicity,1);assert.equal(r.history.csvOnlyOccurrences,1);
 assert.equal(r.impacts.missingPairs,1);assert.equal(r.impacts.fields.rpPaidCents.equal,0);
});
test('rejeita chaves, limite, identidade fora do recorte e pares duplicados antes de consultar',()=>{
 for(const mutate of [p=>p.histories[0].id='158459264222023NE000001',
  p=>p.impacts.push({...p.impacts[0]}),p=>p.histories[0].events[0].count=101,
  p=>p.impacts[0].components.rpPaidCents='10000',p=>p.histories[0].events[0].description='x']){
  const p=fixture();mutate(p);assert.throws(()=>validateCsvPlan(p));
 }
});
test('orçamento interrompe antes de consultar; campos divergentes ou ambíguos são explícitos',async()=>{
 const stopped=await auditCsvTargets(fixture(),{budget:{stopped:()=>true},
 historyResolver:async()=>{throw Error('não deve consultar');}});
 assert.equal(stopped.history.attempted,0);assert.equal(stopped.impacts.attemptedDocuments,0);
 const r=await auditCsvTargets(fixture(),{historyResolver:async()=>({ok:false}),
 paymentResolver:async()=>({ok:true,links:[{from:ob,to:ne,impactComponents:{...components,rpPaidCents:9999}}]})});
 assert.equal(r.history.unavailable,1);assert.equal(r.impacts.fields.rpPaidCents.different,1);
 assert.equal(r.impacts.allComparableFieldsEqual,0);
});

const actualComponents={...components,liquidatedCents:0,rpCancelledCents:0,rowCount:1,repeatedRows:0};
const actualMovement={date:'2026-01-10',operation:'INSCRICAO EM RP',type:'other',quantity:'1',unitPrice:'100',cents:10000};
const original={from:ob,to:ne,cents:10000};
const secondNe='158459264222024NE000002';
const second={from:ob,to:secondNe,cents:20000};
const dateNow=new Date('2026-11-27T20:00:00Z');
function recoveryFixture(){
 const m={...emptyMonth('2026-01'),documents:[{id:ob,date:'2026-01-10',phase:3,cents:30000,paymentLinksChecked:true}],relations:[original,second],coverage:[{date:'2026-01-10',phase:3,complete:true,count:1,invalid:0}]};
 const n={...emptyMonth('2025-12'),documents:[{id:ne,date:'2025-12-12',phase:1,cents:10000,itemsDetailVersion:2}],
  itemsByDocument:{[ne]:[{seq:1,cents:10000}]},coverage:[{date:'2025-12-12',phase:1,complete:true,count:1,invalid:0}]};
 const link={...original,impactComponents:actualComponents};
 return {months:[m,n],confirmed:{histories:[{id:ne,seq:1,movements:[actualMovement,actualMovement]}],
  impacts:[{id:ob,ne,phase:3,link,apiLinks:[link,second]}]}};
}
test('incorpora apenas lacunas confirmadas, preserva valores, pares e multiplicidade; segunda rodada idempotente',()=>{
 const {months,confirmed}=recoveryFixture(),snapshot=JSON.stringify(months);
 const p=planConfirmedCsvRecovery(months,confirmed,dateNow);
 assert.equal(p.summary.historiesAdded,1);assert.equal(p.summary.impactsAdded,1);assert.equal(p.tasks.length,2);
 const updated=new Map(months.map(m=>[m.month,m]));
 for(const t of p.tasks)updated.set(t.month,applyDocumentEnrichment(updated.get(t.month),t.id,t.result,dateNow).data);
 const m=updated.get('2026-01'),n=updated.get('2025-12');
 assert.deepEqual(m.documents,months[0].documents);
 assert.deepEqual(m.relations.find(l=>l.to===secondNe),second);
 assert.equal(m.relations.find(l=>l.to===ne).cents,10000);
 assert.equal(m.relations.find(l=>l.to===ne).impactComponents.rpPaidCents,10000);
 assert.equal(n.itemsByDocument[ne][0].movements.length,2);
 validateMonth(m);validateMonth(n);
 assert.equal(planConfirmedCsvRecovery([...updated.values()],confirmed,dateNow).tasks.length,0);
 assert.equal(JSON.stringify(months),snapshot);
});
test('não grava se API altera ou omite qualquer vínculo legado, inclusive fora da amostra',()=>{
 for(const mutate of [r=>r.apiLinks.pop(),r=>r.apiLinks[1]={...second,cents:20001},
  r=>r.apiLinks.push({...second}),r=>r.apiLinks[0]={...r.link,cents:10001}]){
  const {months,confirmed}=recoveryFixture();mutate(confirmed.impacts[0]);
  const p=planConfirmedCsvRecovery(months,confirmed,dateNow);
  assert.equal(p.summary.impactsAdded,0);assert.equal(p.summary.skipped.legacy_links_differ,1);
 }
});
test('não retifica componente existente nem histórico consultado; identidade ambígua bloqueia recuperação',()=>{
 const {months,confirmed}=recoveryFixture();
 months[0].relations=[{...original,impactComponents:actualComponents},second];
 months[1].itemsByDocument[ne][0]={seq:1,cents:10000,historyChecked:true,movements:[]};
 const p=planConfirmedCsvRecovery(months,confirmed,dateNow);
 assert.equal(p.tasks.length,0);assert.equal(p.summary.skipped.history_already_checked,1);
 assert.equal(p.summary.skipped.impact_already_present,1);
 const duplicate={...emptyMonth('2025-11'),documents:[{id:ne,date:'2025-11-12',phase:1,cents:10000}],coverage:[{date:'2025-11-12',phase:1,complete:true,count:1,invalid:0}]};
 assert.equal(planConfirmedCsvRecovery([...months,duplicate],confirmed,dateNow).summary.historiesAdded,0);
});
test('só encaminha impacto com quatro campos CSV pertinentes e cinco campos API verificáveis',async()=>{
 const p=fixture(),confirmed={histories:[],impacts:[]};
 const resolvers={historyResolver:async()=>({ok:true,movements:[actualMovement,actualMovement]}),
 paymentResolver:async()=>({ok:true,links:[{...original,impactComponents:actualComponents}]}),confirmed};
 await auditCsvTargets(p,resolvers);
 assert.equal(confirmed.histories.length,1);assert.equal(confirmed.impacts.length,0);
 p.impacts[0].components.rpCancelledCents=0;
 await auditCsvTargets(p,resolvers);
 assert.equal(confirmed.impacts.length,1);
 p.impacts[0].components.rpPaidCents=9999;
 await auditCsvTargets(p,resolvers);
 assert.equal(confirmed.impacts.length,1);
});

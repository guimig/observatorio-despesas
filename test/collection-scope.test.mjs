import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FIRST_MONTH,FIRST_DATE,inScopeMonth,inScopeNe,scopeMonths,planCatalogMonth} from '../src/collection-scope.mjs';
import {planHistoricalDays,chooseHistoricalMonth,missingCommitmentYears} from '../src/backfill.mjs';
import {collectDayPhase,documentUrl} from '../src/cgu.mjs';
import {monthBounds} from '../src/procurement.mjs';
import {missingReferencedNe,fetchCguOriginal} from '../src/recover-cgu-originals.mjs';
import {noticeDetailUrl,planMissingNotices} from '../src/pncp-notices-detail.mjs';
const now=new Date('2026-11-24T16:00:00Z');
test('corte inclusivo de janeiro de 2024 e calendario ate competencia atual',()=>{
 assert.equal(FIRST_MONTH,'2024-01');assert.equal(FIRST_DATE,'2024-01-01');
 assert.equal(scopeMonths(now).length,35);
 assert.equal(scopeMonths(now,{includeCurrent:false}).at(-1),'2026-10');
 assert.equal(inScopeMonth('2023-12'),false);
 assert.throws(()=>planHistoricalDays({month:'2023-12',now}));
 assert.throws(()=>documentUrl('31/12/2023',1,1));
 assert.throws(()=>monthBounds('2023-12',now));
 assert.equal(monthBounds('2024-01',now).start,FIRST_DATE);
});
test('barreira de consulta autenticada inclusive manual e injetada',async()=>{
 let calls=0;const fetchFn=async()=>{calls++;throw Error('nao chamar')};
 await assert.rejects(collectDayPhase('31/12/2023',1,{getDocuments:fetchFn}));
 await assert.rejects(fetchCguOriginal('158459264222023NE000001',{token:'test',fetchFn}));
 await assert.rejects(chooseHistoricalMonth({requestedMonth:'2023-12',now}));
 await assert.rejects(chooseHistoricalMonth({earliestMonth:'2023-12',now}));
 assert.equal(calls,0);
});
test('referencia a NE anterior fica no documento mas nao gera recuperacao de origem',()=>{
 const parent='158459264222024NS000001',old='158459264222023NE000001',valid='158459264222024NE000002';
 const month={documents:[{id:parent,date:'2024-02-01',phase:2}],relations:[{from:parent,to:old},{from:parent,to:valid}]};
 assert.equal(inScopeNe(old),false);
 assert.deepEqual(missingReferencedNe([month],{scope:'all'}),[valid]);
 assert.deepEqual(missingCommitmentYears([month]),['2024']);
 assert.equal(month.relations.length,2);
});
test('recuperacao pontual PNCP nao consulta IDs originarios anteriores ao corte',()=>{
 const old='10635424000186-1-000001/2023',valid='10635424000186-1-000001/2024';
 assert.throws(()=>noticeDetailUrl(old));
 assert.deepEqual(planMissingNotices({contracts:[{procurementId:old},{procurementId:valid}]},null),[valid]);
});
test('fila mensal historica ignora competencias completas e roda falhas persistentes',()=>{
 const now=new Date('2024-04-05T15:00:00Z');
 const coverage=[{month:'2024-01',source:'pncp',status:'complete',skipped:0,closedMonth:true},{month:'2024-01',source:'compras',status:'unavailable'},
 {month:'2024-02',source:'pncp',status:'complete',skipped:0,closedMonth:true},{month:'2024-02',source:'compras',status:'complete',skipped:0,closedMonth:true}];
 const opts={keys:['pncp','compras'],kind:'source',now,slot:0};
 assert.deepEqual(planCatalogMonth(coverage,opts),{month:'2024-03',missing:['pncp','compras'],pending:['pncp','compras']});
 const completed=coverage.concat([{month:'2024-03',source:'pncp',status:'complete',skipped:0,closedMonth:true},{month:'2024-03',source:'compras',status:'complete',skipped:0,closedMonth:true}]);
 assert.deepEqual(planCatalogMonth(completed,opts),{month:'2024-01',missing:[],pending:['compras']});
 assert.equal(planCatalogMonth(completed.map(c=>({...c,status:'complete',closedMonth:true})),opts),null);
});
test('rodizio CGU inclui lacunas do mes corrente e avanca entre competencias',async()=>{
 const now=new Date('2024-03-10T12:00:00Z');
 assert.equal(await chooseHistoricalMonth({now,includeCurrent:true,rotationSlot:0}),'2024-01');
 assert.equal(await chooseHistoricalMonth({now,includeCurrent:true,rotationSlot:1}),'2024-02');
 assert.equal(await chooseHistoricalMonth({now,includeCurrent:true,rotationSlot:2}),'2024-03');
});

test('consulta integral durante o mes nao dispensa fechamento posterior',()=>{
 const coverage=[{month:'2024-01',source:'pncp',status:'complete',skipped:0}];
 const opts={keys:['pncp'],kind:'source',now:new Date('2024-02-01T12:00:00Z'),slot:0};
 assert.deepEqual(planCatalogMonth(coverage,opts),{month:'2024-01',missing:[],pending:['pncp']});
 assert.equal(planCatalogMonth([{...coverage[0],closedMonth:true}],opts),null);
});

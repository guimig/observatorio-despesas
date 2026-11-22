import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentDateInBrazil, previousMonthInBrazil, planHistoricalDays, chooseHistoricalMonth, missingCommitmentYears } from '../src/backfill.mjs';

const now = new Date('2026-11-19T20:00:00Z');
const full = (date, count = 0, invalid = 0) => [1, 2, 3].map(phase => ({
  date, phase, complete: true, count, invalid
}));

test('data brasileira e competência anterior respeitam troca de mês e ano', () => {
  assert.equal(currentDateInBrazil(now), '2026-11-19');
  assert.equal(previousMonthInBrazil(now), '2026-10');
  assert.equal(previousMonthInBrazil(new Date('2026-01-01T14:00:00Z')), '2025-12');
});

test('primeiro lote histórico é limitado a três dias elegíveis', () => {
  assert.deepEqual(planHistoricalDays({ month: '2026-10', now }), [
    '01/10/2026', '02/10/2026', '03/10/2026'
  ]);
});

test('dia já completo em três fases não é consultado novamente', () => {
  const existing = { month: '2026-10', coverage: [
    ...full('2026-10-01'), ...full('2026-10-02')
  ] };
  assert.deepEqual(planHistoricalDays({ month: '2026-10', existing, now, batchDays: 3 }),
    ['03/10/2026', '04/10/2026', '05/10/2026']);
});

test('dias com fase incompleta ou valor inválido são retomados', () => {
  const existing = { month: '2026-10', coverage: [
    ...full('2026-10-01'),
    ...full('2026-10-02').map(x => x.phase === 3 ? { ...x, complete: false } : x),
    ...full('2026-10-03').map(x => x.phase === 2 ? { ...x, count: 1, invalid: 1 } : x)
  ] };
  assert.deepEqual(planHistoricalDays({ month: '2026-10', existing, now, batchDays: 2 }),
    ['02/10/2026', '03/10/2026']);
});

test('não consulta hoje nem futuro, e aceita datas históricas anteriores', () => {
  assert.deepEqual(planHistoricalDays({ month: '2026-11', now, startDay: 17, batchDays: 7 }),
    ['17/11/2026', '18/11/2026']);
  assert.deepEqual(planHistoricalDays({ month: '2026-12', now }), []);
});

test('ano bissexto e início de lote respeitam o último dia real', () => {
  assert.deepEqual(planHistoricalDays({
    month: '2024-02', now, startDay: 28, batchDays: 7
  }), ['28/02/2024', '29/02/2024']);
});

test('rechecagem explícita de período completo não reescreve schema', () => {
  const existing = { month: '2026-10', coverage: full('2026-10-01') };
  assert.deepEqual(planHistoricalDays({ month: '2026-10', existing, now, recheck: true, batchDays: 1 }),
    ['01/10/2026']);
});

test('parâmetros e competências inválidos são recusados sem consultas', () => {
  assert.throws(() => planHistoricalDays({ month: '../foo', now }));
  assert.throws(() => planHistoricalDays({ month: '2026-13', now }));
  assert.throws(() => planHistoricalDays({ month: '2026-10', now, batchDays: 8 }));
  assert.throws(() => planHistoricalDays({ month: '2026-10', now, startDay: 0 }));
  assert.throws(() => planHistoricalDays({ month: '2026-10', now,
    existing: { month: '2026-09', coverage: [] } }));
});

test('varredura histórica escolhe mês recente ainda não completo e avança ao anterior',async()=>{
  const recent=await chooseHistoricalMonth({now,earliestMonth:'2026-09',
    loadExisting:async()=>null});
  assert.equal(recent,'2026-10');
  const completeOctober={month:'2026-10',coverage:Array.from({length:31},(_,day)=>
    full('2026-10-'+String(day+1).padStart(2,'0'))).flat()};
  const next=await chooseHistoricalMonth({now,earliestMonth:'2026-09',
    loadExisting:async month=>month==='2026-10'?completeOctober:null});
  assert.equal(next,'2026-09');
});
test('limite inicial, ausência de pendências e seleção explícita são respeitados',async()=>{
  assert.equal(await chooseHistoricalMonth({now,earliestMonth:'2026-11'}),null);
  assert.equal(await chooseHistoricalMonth({now,requestedMonth:'2024-02',
    earliestMonth:'2026-01'}),'2024-02');
  await assert.rejects(chooseHistoricalMonth({now,earliestMonth:'2026-13'}));
  await assert.rejects(chooseHistoricalMonth({now,requestedMonth:'../data'}));
});

test('prioriza exercícios de NEs referenciadas sem documento e preserva modo normal',async()=>{
 const ne2025='158459264222025NE000216';
 assert.deepEqual(missingCommitmentYears([{documents:[],relations:[{from:'158459264222026DF800004',to:ne2025,cents:100}]}]),['2025']);
 const selected=await chooseHistoricalMonth({now,earliestMonth:'2025-01',priorityYears:['2025'],prioritize:true,loadExisting:async()=>null});
 assert.equal(selected,'2025-12');
 const regular=await chooseHistoricalMonth({now,earliestMonth:'2025-01',priorityYears:['2025'],prioritize:false,loadExisting:async()=>null});
 assert.equal(regular,'2026-10');
});
test('não classifica NE já coletada como lacuna nem extrapola limite histórico',async()=>{
 const ne2025='158459264222025NE000216';
 assert.deepEqual(missingCommitmentYears([{documents:[{id:ne2025,phase:1}],relations:[{from:'x',to:ne2025,cents:100}]}]),[]);
 const selected=await chooseHistoricalMonth({now,earliestMonth:'2026-01',priorityYears:['2025'],prioritize:true,loadExisting:async()=>null});
 assert.equal(selected,'2026-10');
});

test('rotacao percorre dias pendentes sem reconsultar os ja completos',()=>{
 const existing={month:'2026-10',coverage:full('2026-10-01')};
 const first=planHistoricalDays({month:'2026-10',existing,now,batchDays:3,dayOffset:0});
 const second=planHistoricalDays({month:'2026-10',existing,now,batchDays:3,dayOffset:3});
 assert.deepEqual(first,['02/10/2026','03/10/2026','04/10/2026']);
 assert.deepEqual(second,['05/10/2026','06/10/2026','07/10/2026']);
 assert.equal(first.some(d=>second.includes(d)),false);
});

test('rotacao realiza retorno circular e respeita limite real de fevereiro',()=>{
 const candidates=planHistoricalDays({month:'2024-02',now,batchDays:7,startDay:27,dayOffset:2});
 assert.deepEqual(candidates,['29/02/2024','27/02/2024','28/02/2024']);
 assert.throws(()=>planHistoricalDays({month:'2026-10',now,dayOffset:-1}));
 assert.throws(()=>planHistoricalDays({month:'2026-10',now,dayOffset:1.5}));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyMonth, mergeMonth, validateMonth, validateManifest,
  persistWindow, validatePublishedData
} from '../src/store.mjs';

const ne = '158459000012026NE000001';
const ns = '158459000012026NS000001';
const make = (date, phase, id, cents, complete = true) => ({
  documents: [{ id, date, phase, cents }], links: [],
  coverage: { date, phase, complete, count: 1, invalid: cents === null ? 1 : 0,
    ...(!complete ? { reason: 'limite_paginas' } : {}) }
});

test('merge ordena registros e não duplica coleta do mesmo dia', () => {
  const first = make('2026-11-18', 1, ne, 1234);
  const a = mergeMonth(emptyMonth('2026-11'), '2026-11', [first]);
  const b = mergeMonth(a.data, '2026-11', [first], new Date('2026-11-20T00:00:00Z'));
  assert.equal(a.changed, true);
  assert.equal(b.changed, false);
  assert.deepEqual(b.data, a.data);
});
test('parcial não substitui mês completo e não apaga registro anterior', () => {
  const full = mergeMonth(emptyMonth('2026-11'), '2026-11', [
    make('2026-11-18', 1, ne, 500)
  ]).data;
  const partial = mergeMonth(full, '2026-11', [
    make('2026-11-18', 1, ne, 100, false)
  ]);
  assert.equal(partial.changed, false);
  assert.equal(partial.data.documents[0].cents, 500);
});
test('relação NS -> NE é válida com alvo de outro mês ainda não carregado', () => {
  const patch = make('2026-11-18', 2, ns, 1000);
  patch.links.push({ from: ns, to: ne, cents: 1000 });
  const result = mergeMonth(emptyMonth('2026-11'), '2026-11', [patch]);
  assert.equal(result.data.relations[0].to, ne);
  assert.doesNotThrow(() => validateMonth(result.data));
});
test('campos livres, CPF bruto e valores fracionários não entram no repositório', () => {
  const patch = make('2026-11-18', 1, ne, 1000);
  const result = mergeMonth(null, '2026-11', [patch]).data;
  result.documents[0].cpf = '000.123.456-78';
  assert.throws(() => validateMonth(result));
  delete result.documents[0].cpf;
  result.documents[0].cents = 10.13;
  assert.throws(() => validateMonth(result));
  assert.throws(() => validateManifest({
    schema_version: 1, unit: '158459', months: [], status: 'dados_publicados'
  }));
});
test('persistência faz upsert mensal, registra manifesto e mantém idempotência', async () => {
  const root = await mkdtemp(join(tmpdir(), 'observatorio-'));
  try {
    const patch = make('2026-11-18', 1, ne, 111);
    const now = new Date('2026-11-19T14:00:00Z');
    const first = await persistWindow(root, [patch], now);
    assert.deepEqual(first.updatedMonths, ['2026-11']);
    const monthPath = join(root, 'data', 'months', '2026-11.json');
    const content = await readFile(monthPath, 'utf8');
    const second = await persistWindow(root, [patch], new Date('2026-11-20T00:00:00Z'));
    assert.deepEqual(second.updatedMonths, []);
    assert.equal(await readFile(monthPath, 'utf8'), content);
    const checked = await validatePublishedData(root);
    assert.equal(checked.manifest.months[0], '2026-11');
    assert.equal(checked.months[0].documents.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('dias distintos e meses distintos são preservados sem duplicar informações', () => {
  const patches = [
    make('2026-11-18', 1, ne, 100),
    make('2026-11-19', 2, ns, 200)
  ];
  const result = mergeMonth(emptyMonth('2026-11'), '2026-11', patches);
  assert.equal(result.data.documents.length, 2);
  assert.equal(result.data.coverage.length, 2);
});


test('catálogo mensal deduplica pessoas jurídicas e protege pessoa física', () => {
  const a = make('2026-11-18', 1, ne, 1000);
  a.documents[0].beneficiary = { type: 'pj', id: '12345678000190',
    name: 'Empresa Exemplo' };
  a.documents[0].process = '23349.000123/2026-01';
  a.documents[0].nature = { group: 'Correntes', element: 'Serviços' };
  const b = make('2026-11-18', 2, ns, 500);
  b.documents[0].beneficiary = { type: 'pj', id: '12345678000190',
    name: 'Empresa Exemplo' };
  const merged = mergeMonth(emptyMonth('2026-11'), '2026-11', [a, b]);
  assert.equal(Object.keys(merged.data.beneficiaries).length, 1);
  assert.equal(merged.data.documents[0].partyRef, '12345678000190');
  assert.equal(merged.data.documents[1].partyRef, '12345678000190');
  assert.equal(JSON.stringify(merged.data).match(/Empresa Exemplo/g).length, 1);
  assert.doesNotThrow(() => validateMonth(merged.data));
  const again = mergeMonth(merged.data, '2026-11', [a, b]);
  assert.equal(again.changed, false);
});
test('CPF mascarado permanece parcial e não cria chave de identidade compartilhada', () => {
  const p = make('2026-11-18', 2, ns, 100);
  p.documents[0].beneficiary = { type: 'pf', id: '***.123.456-**' };
  const merged = mergeMonth(emptyMonth('2026-11'), '2026-11', [p]);
  assert.equal(merged.data.documents[0].cpfMasked, '***.123.456-**');
  assert.equal(merged.data.documents[0].partyRef, undefined);
  assert.equal(merged.data.beneficiaries, undefined);
  assert.doesNotThrow(() => validateMonth(merged.data));
  const corrupted = structuredClone(merged.data);
  corrupted.documents[0].cpfMasked = '000.123.456-78';
  assert.throws(() => validateMonth(corrupted));
});
test('catálogo remove fornecedor sem documentos ativos após retificação', () => {
  const p = make('2026-11-18', 1, ne, 1000);
  p.documents[0].beneficiary = { type: 'pj', id: '12345678000190',
    name: 'Empresa Exemplo' };
  const stored = mergeMonth(emptyMonth('2026-11'), '2026-11', [p]).data;
  const changed = mergeMonth(stored, '2026-11', [make('2026-11-18', 1, ne, 1000)]);
  assert.equal(Object.keys(changed.data.beneficiaries).length, 0);
  assert.equal(changed.data.documents[0].partyRef, undefined);
});

test('identidade unica com participacoes em fases 2 e 3 no mesmo dia',()=>{
  const shared='158459000012025NS000008';
  const phase2=make('2025-12-08',2,shared,1500);
  const phase3=make('2025-12-08',3,shared,1500);
  const first=mergeMonth(emptyMonth('2025-12'),'2025-12',[phase2]);
  const merged=mergeMonth(first.data,'2025-12',[phase3]);
  assert.equal(merged.data.documents.length,1);
  assert.deepEqual(merged.data.phaseObservations,[{
    id:shared,date:'2025-12-08',phase:3,amountKnown:true,amountRelation:'same'
  }]);
  assert.equal(merged.data.coverage.length,2);
  assert.equal(merged.data.coverage.find(c=>c.phase===3).count,1);
  assert.doesNotThrow(()=>validateMonth(merged.data));
  const again=mergeMonth(merged.data,'2025-12',[phase3]);
  assert.equal(again.changed,false);
});

test('valores divergentes entre fases nao viram documentos nem soma adicional',()=>{
  const shared='158459000012025NS000010';
  const existing=mergeMonth(emptyMonth('2025-12'),'2025-12',[
    make('2025-12-10',2,shared,500)
  ]).data;
  const next=mergeMonth(existing,'2025-12',[make('2025-12-10',3,shared,700)]).data;
  assert.equal(next.documents[0].cents,500);
  assert.equal(next.documents.length,1);
  assert.equal(next.phaseObservations[0].amountRelation,'different');
  assert.equal(next.phaseObservations[0].amountKnown,true);
  assert.equal(next.coverage.find(c=>c.phase===3).count,1);
});

test('fase 3 com valor ausente preserva invalid e documento original',()=>{
  const shared='158459000012025NS000019';
  const initial=mergeMonth(emptyMonth('2025-12'),'2025-12',[make('2025-12-10',2,shared,100)]).data;
  const overlap=mergeMonth(initial,'2025-12',[make('2025-12-10',3,shared,null)]).data;
  assert.equal(overlap.phaseObservations[0].amountKnown,false);
  assert.equal(overlap.phaseObservations[0].amountRelation,'unknown');
  assert.equal(overlap.coverage.find(c=>c.phase===3).invalid,1);
  assert.doesNotThrow(()=>validateMonth(overlap));
});

test('mesmo ID em dias distintos continua bloqueado para revisao',()=>{
  const shared='158459000012025NS000099';
  const initial=mergeMonth(emptyMonth('2025-12'),'2025-12',[make('2025-12-08',2,shared,100)]).data;
  assert.throws(()=>mergeMonth(initial,'2025-12',[make('2025-12-10',3,shared,100)]),
    /datas diferentes/);
});

test('observacoes orfas, duplicadas ou sem cobertura sao rejeitadas',()=>{
  const shared='158459000012025NS000034';
  const original=mergeMonth(emptyMonth('2025-12'),'2025-12',[make('2025-12-08',2,shared,100)]).data;
  const derived=mergeMonth(original,'2025-12',[make('2025-12-08',3,shared,100)]).data;
  const orphan=structuredClone(derived);
  orphan.phaseObservations[0].id='158459000012025NS000035';
  assert.throws(()=>validateMonth(orphan),/Aparicao documental/);
  const repeated=structuredClone(derived);
  repeated.phaseObservations.push({...repeated.phaseObservations[0]});
  assert.throws(()=>validateMonth(repeated),/Aparicao documental/);
  const uncovered=structuredClone(derived);
  uncovered.coverage=uncovered.coverage.filter(c=>c.phase!==3);
  assert.throws(()=>validateMonth(uncovered),/Aparicao sem cobertura/);
});

test('retificacao nao pode excluir documento canônico referenciado por outra fase',()=>{
  const shared='158459000012025NS000041';
  const initial=mergeMonth(emptyMonth('2025-12'),'2025-12',[
    make('2025-12-08',2,shared,100),
    make('2025-12-08',3,shared,100)
  ]).data;
  const removal={documents:[],links:[],
    coverage:{date:'2025-12-08',phase:2,complete:true,count:0,invalid:0}};
  assert.throws(()=>mergeMonth(initial,'2025-12',[removal]),/referenciado por outra fase/);
});

test('retificacao do valor canônico invalida apenas comparacao, sem apagar outra fase',()=>{
  const shared='158459000012025NS000052';
  let month=mergeMonth(emptyMonth('2025-12'),'2025-12',[
    make('2025-12-08',2,shared,100),
    make('2025-12-08',3,shared,100)
  ]).data;
  month=mergeMonth(month,'2025-12',[make('2025-12-08',2,shared,150)]).data;
  assert.equal(month.documents[0].cents,150);
  assert.equal(month.phaseObservations[0].amountRelation,'unknown');
  assert.equal(month.coverage.length,2);
  assert.doesNotThrow(()=>validateMonth(month));
});

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

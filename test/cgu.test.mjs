import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMoneyCents, isoDate, datesBeforeToday, documentUrl, impactUrl,
  getCguArray, normalizeDocument, resolveLiquidation, collectDayPhase, collectWindow
} from '../src/cgu.mjs';

const ne = '158459000012026NE000001';
const ns = '158459000012026NS000001';
const ob = '158459000012026OB000001';
const row = (id, amount, extra = {}) => ({
  codigoUg: '158459', documento: id, valor: amount,
  cpf: '000.123.456-78', nomeFavorecido: 'NÃO PUBLICAR', ...extra
});
const pages = entries => async (date, phase, page) =>
  entries[date + '/' + phase + '/' + page] || [];

test('conversão monetária em centavos sem transformar ausências em zero', () => {
  assert.equal(parseMoneyCents('R$ 1.234,56'), 123456);
  assert.equal(parseMoneyCents('-12,34'), -1234);
  assert.equal(parseMoneyCents('(10,50)'), -1050);
  assert.equal(parseMoneyCents(1.25), 125);
  assert.equal(parseMoneyCents(null), null);
  assert.equal(parseMoneyCents('sem valor'), null);
});
test('data e timezone do campus consultam somente dias encerrados', () => {
  assert.equal(isoDate('19/11/2026'), '2026-11-19');
  assert.throws(() => isoDate('30/02/2026'));
  assert.deepEqual(datesBeforeToday(new Date('2026-11-19T14:00:00Z'), 2),
    ['17/11/2026', '18/11/2026']);
});
test('filtros fixam UG e não incluem token na URL', () => {
  const url = new URL(documentUrl('18/11/2026', 2, 3));
  assert.equal(url.searchParams.get('unidadeGestora'), '158459');
  assert.equal(url.searchParams.get('fase'), '2');
  assert.equal(url.searchParams.get('pagina'), '3');
  assert.equal(new URL(impactUrl(ns, 1)).searchParams.get('codigoDocumento'), ns);
  assert.throws(() => impactUrl('00012345678', 1));
});
test('header autenticado sem registro do CPF da fonte', async () => {
  const result = await getCguArray(documentUrl('18/11/2026', 1, 1), {
    token: 'fake-secret', fetcher: async (url, options) => {
      assert.equal(url.includes('fake-secret'), false);
      assert.equal(options.headers['chave-api-dados'], 'fake-secret');
      return { ok: true, status: 200, json: async () => [] };
    }
  });
  assert.deepEqual(result, []);
  const safe = normalizeDocument(row(ne, '11,10'), '18/11/2026', 1);
  assert.deepEqual(safe, { id: ne, date: '2026-11-18', phase: 1, cents: 1110 });
  assert.equal(JSON.stringify(safe).includes('000.123.456-78'), false);
});
test('filtra UG incorreta e documento não SIAFI', () => {
  assert.throws(() => normalizeDocument(row(ne, 10, { codigoUg: '158125' }), '18/11/2026', 1));
  assert.throws(() => normalizeDocument(row('00012345678', 10), '18/11/2026', 1));
});
test('soma impactos com sinais negativos e cria vínculo NS para NE válido', async () => {
  const impacts = async (_, page) => page === 1 ? [
    { empenho: ne, subitem: '01', valorLiquidado: '50,00' },
    { empenho: ne, subitem: '02', valorLiquidado: '-2,50' }
  ] : [];
  const result = await resolveLiquidation(ns, { token: 'fake', request: impacts });
  assert.equal(result.cents, 4750);
  assert.deepEqual(result.links, [{ from: ns, to: ne, cents: 4750 }]);
  const phase = await collectDayPhase('18/11/2026', 2, {
    token: 'fake', getDocuments: pages({
      '18/11/2026/2/1': [row(ns, null)]
    }), getImpacts: impacts
  });
  assert.equal(phase.documents[0].cents, 4750);
  assert.equal(phase.coverage.invalid, 0);
  assert.equal(phase.links.length, 1);
});
test('impacto vazio, ilegível e repetido não gera zero artificial', async () => {
  const empty = await resolveLiquidation(ns, { token: 'fake', request: async () => [] });
  assert.equal(empty.cents, null);
  const invalid = await resolveLiquidation(ns, { token: 'fake', request: async () => [
    { valorLiquidado: 'não numérico', empenho: ne }
  ]});
  assert.equal(invalid.cents, null);
  const repeated = await resolveLiquidation(ns, { token: 'fake', request: async () => [
    { valorLiquidado: '5,00', empenho: ne }
  ]});
  assert.equal(repeated.reason, 'repeat_impact_page');
});
test('pagamentos percorrem mais de cinco páginas e encerram pela página vazia', async () => {
  const entries = {};
  for (let page = 1; page <= 9; page++) {
    entries['17/11/2026/3/' + page] = [row(
      '158459000012026OB' + String(page).padStart(6, '0'), page
    )];
  }
  const result = await collectDayPhase('17/11/2026', 3, {
    token: 'fake', maxPages: 30, getDocuments: pages(entries)
  });
  assert.equal(result.documents.length, 9);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.invalid, 0);
});
test('paginação truncada marca cobertura parcial sem inventar conclusão', async () => {
  const result = await collectDayPhase('18/11/2026', 3, {
    token: 'fake', maxPages: 1,
    getDocuments: pages({ '18/11/2026/3/1': [row(ob, 10)] })
  });
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.reason, 'limite_paginas');
});
test('janela agrupa por fases sem confundir UG 158459 com UO 26422', async () => {
  const result = await collectWindow({
    token: 'fake', lookback: 1, now: new Date('2026-11-19T14:00:00Z'),
    getDocuments: pages({ '18/11/2026/1/1': [row(ne, '100,00')] })
  });
  assert.equal(result.length, 3);
  assert.equal(result[0].documents[0].cents, 10000);
  assert.equal(result[1].coverage.count, 0);
  assert.equal(JSON.stringify(result).includes('NÃO PUBLICAR'), false);
});


test('coleta histórica permite selecionar dias explícitos sem consultar outros dias', async () => {
  const calls = [];
  const result = await collectWindow({
    token: 'fake', dates: ['03/10/2026'], now: new Date('2026-11-19T14:00:00Z'),
    getDocuments: async (date, phase, page) => {
      calls.push([date, phase, page]);
      return [];
    }
  });
  assert.equal(result.length, 3);
  assert.deepEqual(calls, [
    ['03/10/2026', 1, 1], ['03/10/2026', 2, 1], ['03/10/2026', 3, 1]
  ]);
});
test('coleta por datas explícitas rejeita datas inexistentes e duplicadas', async () => {
  await assert.rejects(collectWindow({
    token: 'fake', dates: ['30/02/2026'], getDocuments: async () => []
  }));
  await assert.rejects(collectWindow({
    token: 'fake', dates: ['03/10/2026', '03/10/2026'], getDocuments: async () => []
  }));
});

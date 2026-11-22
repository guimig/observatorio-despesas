import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMoneyCents, isoDate, datesBeforeToday, documentUrl, impactUrl,
  getCguArray, retryDelay, normalizeDocument, resolveLiquidation, collectDayPhase, collectWindow
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


test('CGU pessoa jurídica fornece CNPJ e nome, processo e classificação sanitizados', () => {
  const doc = normalizeDocument({
    codigoUg: '158459', documento: '158459000012026NE000002', valor: '150,00',
    codigoFavorecido: '12.345.678/0001-90', nomeFavorecido: 'Empresa Exemplo Ltda.',
    numeroProcesso: '23349.000123/2026-01',
    grupo: 'Outras Despesas Correntes', elemento: 'Serviços de Terceiros',
    programa: 'Educação Profissional', acao: 'Ação Teste',
    observacao: 'Não publicar uma observação integral com dados pessoais user@example.com'
  }, '18/11/2026', 1);
  assert.deepEqual(doc.beneficiary, {
    type: 'pj', id: '12345678000190', name: 'Empresa Exemplo Ltda.'
  });
  assert.equal(doc.process, '23349.000123/2026-01');
  assert.equal(doc.nature.group, 'Outras Despesas Correntes');
  assert.equal(doc.nature.action, 'Ação Teste');
  assert.equal(JSON.stringify(doc).includes('Não publicar uma observação'), false);
});
test('CGU pessoa física jamais divulga nome nem CPF completo', () => {
  const doc = normalizeDocument({
    codigoUg: '158459', documento: '158459000012026OB000002', valor: '9,99',
    codigoFavorecido: '000.123.456-78', nomeFavorecido: 'PESSOA NÃO PUBLICÁVEL',
    numeroProcesso: 'CPF 000.123.456-78'
  }, '18/11/2026', 3);
  assert.deepEqual(doc.beneficiary, { type: 'pf', id: '***.123.456-**' });
  assert.equal(doc.process, undefined);
  assert.equal(JSON.stringify(doc).includes('000.123.456-78'), false);
  assert.equal(JSON.stringify(doc).includes('PESSOA NÃO PUBLICÁVEL'), false);
});
test('favorecido de código ambíguo não gera falsa identificação', () => {
  const doc = normalizeDocument({
    codigoUg: '158459', documento: '158459000012026OB000003',
    codigoFavorecido: '00012345', nomeFavorecido: 'NOME RESTRITO', valor: '1,00'
  }, '18/11/2026', 3);
  assert.equal(doc.beneficiary, undefined);
  assert.equal(JSON.stringify(doc).includes('NOME RESTRITO'), false);
});

test('backoff exponencial respeita Retry-After e limite de espera',async()=>{
 assert.deepEqual([0,1,2,3].map(attempt=>retryDelay(attempt)),[1000,2000,4000,8000]);
 assert.equal(retryDelay(0,{retryAfter:'3'}),3000);
 assert.equal(retryDelay(0,{retryAfter:'120'}),30000);
 assert.equal(retryDelay(1,{retryAfter:'invalido'}),2000);
 const waits=[];let attempts=0;
 const rows=await getCguArray('https://example.invalid',{token:'fake',wait:async ms=>waits.push(ms),
 fetcher:async()=>{attempts++;return attempts<3?{status:429,ok:false,headers:{get:()=> '3'}}:
 {status:200,ok:true,json:async()=>[]};}});
 assert.deepEqual(rows,[]);
 assert.deepEqual(waits,[3000,3000]);
});

test('falha HTTP expõe somente status numérico, sem corpo nem credenciais',async()=>{
 await assert.rejects(getCguArray('https://example.invalid',{token:'fake',
  fetcher:async()=>({status:403,ok:false})}),error=>{
   assert.equal(error.status,403);
   assert.equal(error.message,'CGU HTTP 403');
   assert.equal(JSON.stringify(error).includes('fake'),false);
   return true;
  });
});

test('respostas JSON inválidas e formatos não listáveis têm códigos previsíveis',async()=>{
 await assert.rejects(getCguArray('https://example.invalid',{token:'fake',
  fetcher:async()=>({status:200,ok:true,json:async()=>{throw SyntaxError('payload')}})}),
  error=>error.code==='CGU_INVALID_JSON');
 await assert.rejects(getCguArray('https://example.invalid',{token:'fake',
  fetcher:async()=>({status:200,ok:true,json:async()=>({data:[]})})}),
  error=>error.code==='CGU_INVALID_SHAPE');
});

test('falha final de rede e timeout são distintos, com retries limitados',async()=>{
 let calls=0;
 await assert.rejects(getCguArray('https://example.invalid',{token:'fake',wait:async()=>{},
  fetcher:async()=>{calls++;throw new TypeError('Network unavailable')}}),
  error=>error.code==='CGU_TRANSPORT');
 assert.equal(calls,4);
 await assert.rejects(getCguArray('https://example.invalid',{token:'fake',wait:async()=>{},
  fetcher:async()=>{const e=Error('aborted');e.name='AbortError';throw e}}),
  error=>error.code==='CGU_TIMEOUT');
});

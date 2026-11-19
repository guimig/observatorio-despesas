/**
 * Adaptador isolado da API CGU / Portal da Transparência.
 * Nunca retorna a resposta bruta aos arquivos públicos. Fonte do laboratório
 * validado em guimig/EmailBackupHub (11/2026), com normalização canônica.
 */
import { assertPublicSafe } from './privacy.mjs';

export const UG = '158459';
const BASE = 'https://api.portaldatransparencia.gov.br/api-de-dados/despesas';
const SIAFI_DOC = /^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/;
const SIAFI_NE = /^158459\d{5}20\d{2}NE\d{6}$/;
const PHASES = [1, 2, 3];

function integer(value, fallback, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw Error('Configuração de limite inválida');
  return n;
}

export function parseMoneyCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const cents = Math.round(value * 100);
    return Number.isSafeInteger(cents) ? cents : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.trim().replace(/\s|R\$/gi, '');
  const wrapped = /^\(.*\)$/.test(text);
  if (wrapped) text = text.slice(1, -1);
  if (!/^-?[\d.,]+$/.test(text)) return null;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  const cents = Math.round(parsed * 100) * (wrapped ? -1 : 1);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function isoDate(brDate) {
  if (!/^\d{2}\/\d{2}\/20\d{2}$/.test(brDate)) throw Error('Data CGU inválida');
  const [d, m, y] = brDate.split('/').map(Number);
  const iso = String(y) + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const roundTrip = new Date(iso + 'T00:00:00Z');
  if (!Number.isFinite(roundTrip.getTime()) || roundTrip.toISOString().slice(0, 10) !== iso) {
    throw Error('Data CGU inexistente');
  }
  return iso;
}

export function datesBeforeToday(now = new Date(), lookback = 7) {
  const days = integer(lookback, 7, 31);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric'
  }).formatToParts(now).map(part => [part.type, part.value]));
  const midnight = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  return Array.from({ length: days }, (_, i) => {
    const dt = new Date(midnight - (days - i) * 86400000);
    return String(dt.getUTCDate()).padStart(2, '0') + '/' +
      String(dt.getUTCMonth() + 1).padStart(2, '0') + '/' + dt.getUTCFullYear();
  });
}

export function documentUrl(date, phase, page) {
  isoDate(date);
  if (!PHASES.includes(phase) || !Number.isSafeInteger(page) || page < 1) {
    throw Error('Parâmetros CGU inválidos');
  }
  return BASE + '/documentos?' + new URLSearchParams({
    unidadeGestora: UG, dataEmissao: date, fase: String(phase), pagina: String(page)
  });
}

export function impactUrl(document, page) {
  if (!SIAFI_DOC.test(document) || !Number.isSafeInteger(page) || page < 1) {
    throw Error('Identificador SIAFI inválido');
  }
  return BASE + '/empenhos-impactados?' + new URLSearchParams({
    codigoDocumento: document, fase: '2', pagina: String(page)
  });
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function getCguArray(url, { token, fetcher = fetch, wait = pause } = {}) {
  if (!token || typeof token !== 'string') throw Error('CGU_API_KEY ausente');
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let response;
    try {
      response = await fetcher(url, {
        signal: controller.signal, headers: {
          Accept: 'application/json', 'chave-api-dados': token
        }
      });
    } catch {
      if (attempt === 3) throw Error('CGU indisponível após novas tentativas');
      await wait(750 * (attempt + 1));
      continue;
    } finally { clearTimeout(timeout); }
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
      await wait(750 * (attempt + 1)); continue;
    }
    if (!response.ok) throw Error('CGU HTTP ' + response.status);
    let body;
    try { body = await response.json(); }
    catch { throw Error('CGU retornou JSON inesperado'); }
    if (!Array.isArray(body)) throw Error('CGU retornou formato diferente de lista');
    return body;
  }
  throw Error('CGU indisponível');
}

export function requestDocuments(date, phase, page, options) {
  return getCguArray(documentUrl(date, phase, page), options);
}
export function requestImpacts(doc, page, options) {
  return getCguArray(impactUrl(doc, page), options);
}

export function normalizeDocument(row, date, phase) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Documento CGU inválido');
  const ug = String(row.codigoUg ?? row.codigoUG ?? row.unidadeGestora?.codigo ?? '');
  const id = String(row.documento ?? '').trim();
  if (ug !== UG || !SIAFI_DOC.test(id)) throw Error('Documento não corresponde à UG 158459');
  const doc = { id, date: isoDate(date), phase, cents: parseMoneyCents(row.valor) };
  return assertPublicSafe(doc);
}

function fingerprint(rows, keys) {
  return JSON.stringify(rows.map(row => keys.map(k => row?.[k] ?? null)));
}

function relatedEmpenho(row) {
  const raw = row?.empenho;
  const identifier = typeof raw === 'string' ? raw :
    (raw?.documento ?? row?.codigoEmpenho ?? row?.numeroEmpenho ?? '');
  const id = String(identifier);
  return SIAFI_NE.test(id) ? id : null;
}

/**
 * Retorna valor em centavos e vínculos NS -> NE comprovados pelo recurso impactados.
 * Se houver paginação truncada ou valor ilegível, nunca publica total monetário.
 */
export async function resolveLiquidation(id, {
  token, maxPages = 8, request = requestImpacts
} = {}) {
  const limit = integer(maxPages, 8, 30);
  const seen = new Set();
  const byEmpenho = new Map();
  let total = 0, count = 0, unlinked = 0;
  try {
    for (let page = 1; page <= limit; page++) {
      const rows = await request(id, page, { token });
      if (!Array.isArray(rows)) return { cents: null, links: [], reason: 'invalid_response' };
      if (!rows.length) {
        if (!count) return { cents: null, links: [], reason: 'empty_impact' };
        return { cents: total, links: [...byEmpenho.entries()].map(([to, cents]) =>
          ({ from: id, to, cents })), unlinked };
      }
      const key = fingerprint(rows, ['empenho', 'subitem', 'valorLiquidado']);
      if (seen.has(key)) return { cents: null, links: [], reason: 'repeat_impact_page' };
      seen.add(key);
      for (const impact of rows) {
        const cents = parseMoneyCents(impact?.valorLiquidado);
        if (cents === null || !Number.isSafeInteger(total + cents)) {
          return { cents: null, links: [], reason: 'invalid_impact_amount' };
        }
        total += cents;
        count++;
        const to = relatedEmpenho(impact);
        if (to) byEmpenho.set(to, (byEmpenho.get(to) || 0) + cents);
        else unlinked++;
      }
    }
    return { cents: null, links: [], reason: 'impact_limit' };
  } catch {
    return { cents: null, links: [], reason: 'impact_fetch_failure' };
  }
}

export async function collectDayPhase(date, phase, {
  token, maxPages = 30, maxImpactPages = 8,
  getDocuments = requestDocuments, getImpacts = requestImpacts
} = {}) {
  const limit = integer(maxPages, 30, 80);
  const found = new Map(), pageKeys = new Set();
  const links = [];
  let complete = false, reason = null;
  for (let page = 1; page <= limit; page++) {
    const rows = await getDocuments(date, phase, page, { token });
    if (!Array.isArray(rows)) throw Error('Página documental CGU inválida');
    if (!rows.length) { complete = true; break; }
    const key = fingerprint(rows, ['documento', 'codigoUg', 'valor']);
    if (pageKeys.has(key)) { reason = 'pagina_repetida'; break; }
    pageKeys.add(key);
    for (const row of rows) {
      const doc = normalizeDocument(row, date, phase);
      const previous = found.get(doc.id);
      if (previous && previous.cents !== doc.cents) throw Error('Documento CGU duplicado divergente');
      found.set(doc.id, doc);
    }
  }
  if (!complete && !reason) reason = 'limite_paginas';

  let unresolvedLinks = 0;
  if (phase === 2) {
    for (const doc of found.values()) {
      if (doc.cents !== null) continue;
      const resolved = await resolveLiquidation(doc.id, {
        token, maxPages: maxImpactPages, request: getImpacts
      });
      if (resolved.cents === null) continue;
      doc.cents = resolved.cents;
      links.push(...resolved.links);
      unresolvedLinks += resolved.unlinked || 0;
    }
  }
  const documents = [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
  const invalid = documents.filter(item => item.cents === null).length;
  const coverage = {
    date: isoDate(date), phase, complete, count: documents.length, invalid,
    ...(reason ? { reason } : {}),
    ...(unresolvedLinks ? { unlinked: unresolvedLinks } : {})
  };
  return { documents, links, coverage };
}

export async function collectWindow({
  token, now = new Date(), lookback = 7, maxPages = 30,
  maxImpactPages = 8, getDocuments = requestDocuments, getImpacts = requestImpacts
} = {}) {
  if (!token) throw Error('CGU_API_KEY ausente');
  const dates = datesBeforeToday(now, lookback);
  const queries = dates.flatMap(date => PHASES.map(phase => ({ date, phase })));
  // Concorrência baixa para evitar cota CGU. Nenhuma resposta bruta é persistida.
  const output = new Array(queries.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (cursor < queries.length) {
      const i = cursor++;
      output[i] = await collectDayPhase(queries[i].date, queries[i].phase, {
        token, maxPages, maxImpactPages, getDocuments, getImpacts
      });
    }
  }));
  return output;
}

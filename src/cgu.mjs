/**
 * Adaptador isolado da API CGU / Portal da Transparência.
 * Nunca retorna a resposta bruta aos arquivos públicos. Fonte do laboratório
 * validado em guimig/EmailBackupHub (11/2026), com normalização canônica.
 */
import { assertPublicSafe, maskCpf, sanitizeText } from './privacy.mjs';

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
/** Exponential backoff capped at 8s; Retry-After is honored up to 30s. */
export function retryDelay(attempt,{retryAfter=null,now=Date.now()}={}){
  if(!Number.isSafeInteger(attempt)||attempt<0||attempt>3)throw Error('Tentativa inválida');
  const exponential=Math.min(8000,1000*(2**attempt));
  if(retryAfter===null||retryAfter===undefined)return exponential;
  const raw=String(retryAfter).trim();
  let requested;
  if(/^\d+$/.test(raw))requested=Number(raw)*1000;
  else {
    const date=Date.parse(raw);
    requested=Number.isFinite(date)?date-now:NaN;
  }
  return Number.isFinite(requested)?Math.min(30000,Math.max(exponential,requested)):exponential;
}

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
    } catch (cause) {
      if (attempt === 3) {
        const error=Error('CGU indisponível após novas tentativas');
        error.code=cause?.name==='AbortError'?'CGU_TIMEOUT':'CGU_TRANSPORT';
        throw error;
      }
      await wait(retryDelay(attempt));
      continue;
    } finally { clearTimeout(timeout); }
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
      await wait(retryDelay(attempt,{retryAfter:response.headers?.get?.('retry-after')})); continue;
    }
    if (!response.ok) {
      const error=Error('CGU HTTP ' + response.status);
      error.status=response.status;
      throw error;
    }
    let body;
    try { body = await response.json(); }
    catch {
      const error=Error('CGU retornou JSON inesperado');
      error.code='CGU_INVALID_JSON';
      throw error;
    }
    if (!Array.isArray(body)) {
      const error=Error('CGU retornou formato diferente de lista');
      error.code='CGU_INVALID_SHAPE';
      throw error;
    }
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

function shortPublicText(value, max = 120) {
  if (typeof value !== 'string') return null;
  const output = sanitizeText(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return output && output.length <= max ? output : null;
}

/** Somente pessoa jurídica identificada por CNPJ recebe nome público no JSON. */
export function normalizeBeneficiary(row) {
  const raw = String(row?.codigoFavorecido ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (/^\d{14}$/.test(digits)) {
    const name = shortPublicText(row?.nomeFavorecido, 160);
    return { type: 'pj', id: digits, ...(name ? { name } : {}) };
  }
  if (/^\d{11}$/.test(digits) || /^\*\*\*\.\d{3}\.\d{3}-\*\*$/.test(raw)) {
    return { type: 'pf', id: maskCpf(raw) };
  }
  // Identificação ambígua ou inexistente: não publicar nome ou código incerto.
  return null;
}

export function normalizeDocument(row, date, phase) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Documento CGU inválido');
  const ug = String(row.codigoUg ?? row.codigoUG ?? row.unidadeGestora?.codigo ?? '');
  const id = String(row.documento ?? '').trim();
  if (ug !== UG || !SIAFI_DOC.test(id)) throw Error('Documento não corresponde à UG 158459');
  const doc = { id, date: isoDate(date), phase, cents: parseMoneyCents(row.valor) };
  const beneficiary = normalizeBeneficiary(row);
  if (beneficiary) doc.beneficiary = beneficiary;
  const process = shortPublicText(row.numeroProcesso, 90);
  if (process && /^[A-Za-z0-9./\- ]+$/.test(process)) doc.process = process;
  // Códigos e descrições de classificações conhecidos do schema real da CGU.
  const nature = Object.fromEntries([
    ['group', row.grupo], ['element', row.elemento],
    ['program', row.programa], ['action', row.acao]
  ].map(([key, value]) => [key, shortPublicText(value, 120)]).filter(([, value]) => value));
  if (Object.keys(nature).length) doc.nature = nature;
  // Observações livres podem conter dados pessoais além do CPF: ainda não publicadas.
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
  token, now = new Date(), lookback = 7, dates = undefined, maxPages = 30,
  maxImpactPages = 8, getDocuments = requestDocuments, getImpacts = requestImpacts
} = {}) {
  if (!token) throw Error('CGU_API_KEY ausente');
  const selected = dates === undefined ? datesBeforeToday(now, lookback) : dates;
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 31 ||
      new Set(selected).size !== selected.length) throw Error('Janela de datas CGU inválida');
  selected.forEach(isoDate); // Datas legíveis e existentes, sem receber texto arbitrário.
  const queries = selected.flatMap(date => PHASES.map(phase => ({ date, phase })));
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

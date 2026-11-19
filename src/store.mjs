/** Cache canônico mensal, idempotente e independente da produção do EmailBackupHub. */
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPublicSafe } from './privacy.mjs';
import { UG } from './cgu.mjs';

export const VERSION = 1;
const DOCUMENT_RE = /^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/;
const MONTH_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/;
const phases = new Set([1, 2, 3]);

export const emptyManifest = () => ({
  schema_version: VERSION, unit: UG, status: 'aguardando_primeira_coleta', months: []
});
export const emptyMonth = month => ({
  schema_version: VERSION, unit: UG, month, source: 'CGU',
  documents: [], relations: [], coverage: []
});

function assertAllowedKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !keys.includes(key))) throw Error('Campo não autorizado no JSON público');
}
function assertCents(value) {
  if (value !== null && !Number.isSafeInteger(value)) throw Error('Valor monetário inválido');
}
function validId(id) { return typeof id === 'string' && DOCUMENT_RE.test(id); }

export function validateMonth(data) {
  assertPublicSafe(data);
  assertAllowedKeys(data, ['schema_version', 'unit', 'month', 'source',
    'documents', 'relations', 'coverage', 'updated_at']);
  if (data.schema_version !== VERSION || data.unit !== UG || !MONTH_RE.test(data.month) ||
    data.source !== 'CGU' || !Array.isArray(data.documents) ||
    !Array.isArray(data.relations) || !Array.isArray(data.coverage)) {
    throw Error('Esquema mensal inválido');
  }
  const ids = new Set();
  for (const doc of data.documents) {
    assertAllowedKeys(doc, ['id', 'date', 'phase', 'cents']);
    if (!validId(doc.id) || !DATE_RE.test(doc.date) ||
      !doc.date.startsWith(data.month) || !phases.has(doc.phase) || ids.has(doc.id)) {
      throw Error('Documento público inválido ou duplicado');
    }
    assertCents(doc.cents); ids.add(doc.id);
  }
  for (const link of data.relations) {
    assertAllowedKeys(link, ['from', 'to', 'cents']);
    if (!validId(link.from) || !validId(link.to) || !ids.has(link.from)) {
      throw Error('Vínculo documental inválido');
    }
    assertCents(link.cents);
    if (link.cents === null) throw Error('Vínculo sem valor comprovado');
  }
  const keys = new Set();
  for (const c of data.coverage) {
    assertAllowedKeys(c, ['date', 'phase', 'complete', 'count', 'invalid', 'reason', 'unlinked']);
    if (!DATE_RE.test(c.date) || !c.date.startsWith(data.month) ||
      !phases.has(c.phase) || typeof c.complete !== 'boolean' ||
      !Number.isSafeInteger(c.count) || c.count < 0 ||
      !Number.isSafeInteger(c.invalid) || c.invalid < 0 || c.invalid > c.count ||
      (c.reason !== undefined && !['limite_paginas', 'pagina_repetida'].includes(c.reason)) ||
      (c.unlinked !== undefined && (!Number.isSafeInteger(c.unlinked) || c.unlinked < 0))) {
      throw Error('Cobertura documental inválida');
    }
    const key = c.date + '/' + c.phase;
    if (keys.has(key)) throw Error('Cobertura documental duplicada');
    keys.add(key);
    const matched = data.documents.filter(doc => doc.date === c.date && doc.phase === c.phase);
    if (matched.length !== c.count ||
        matched.filter(doc => doc.cents === null).length !== c.invalid) {
      throw Error('Contagem documental divergente');
    }
    if (c.complete && c.reason) throw Error('Consulta completa com motivo parcial');
  }
  for (const doc of data.documents) {
    if (!keys.has(doc.date + '/' + doc.phase)) throw Error('Documento sem cobertura declarada');
  }
  return data;
}
export function validateManifest(data) {
  assertPublicSafe(data);
  assertAllowedKeys(data, ['schema_version', 'unit', 'status', 'months', 'updated_at']);
  if (data.schema_version !== VERSION || data.unit !== UG ||
    !['aguardando_primeira_coleta', 'dados_publicados'].includes(data.status) ||
    !Array.isArray(data.months) ||
    data.months.some(value => typeof value !== 'string' || !MONTH_RE.test(value)) ||
    new Set(data.months).size !== data.months.length) throw Error('Manifesto inválido');
  if (data.status === 'dados_publicados' && !data.months.length) throw Error('Manifesto sem dados');
  return data;
}

export function mergeMonth(existing, month, patches, now = new Date()) {
  if (!MONTH_RE.test(month)) throw Error('Competência mensal inválida');
  const original = validateMonth(structuredClone(existing || emptyMonth(month)));
  if (original.month !== month) throw Error('Competência incompatível');
  let next = structuredClone(original);
  for (const patch of patches) {
    const { coverage, documents, links } = patch;
    const key = coverage.date + '/' + coverage.phase;
    if (!coverage.date.startsWith(month) || !Array.isArray(documents) ||
        !Array.isArray(links)) throw Error('Lote CGU incompatível com o mês');
    const previous = next.coverage.find(c => c.date + '/' + c.phase === key);
    // Uma nova resposta truncada nunca substitui um retrato já completo.
    if (previous?.complete && !coverage.complete) continue;
    if (previous && !previous.complete && !coverage.complete &&
        previous.count > coverage.count) continue;
    const removed = next.documents.filter(doc =>
      doc.date === coverage.date && doc.phase === coverage.phase).map(doc => doc.id);
    const removedIds = new Set(removed);
    next.documents = next.documents.filter(doc =>
      !(doc.date === coverage.date && doc.phase === coverage.phase));
    next.relations = next.relations.filter(link => !removedIds.has(link.from));
    next.coverage = next.coverage.filter(c => c.date + '/' + c.phase !== key);
    next.documents.push(...structuredClone(documents));
    next.relations.push(...structuredClone(links));
    next.coverage.push(structuredClone(coverage));
  }
  next.documents.sort((a, b) => a.date.localeCompare(b.date) ||
    a.phase - b.phase || a.id.localeCompare(b.id));
  next.relations.sort((a, b) => a.from.localeCompare(b.from) ||
    a.to.localeCompare(b.to) || a.cents - b.cents);
  next.coverage.sort((a, b) => a.date.localeCompare(b.date) || a.phase - b.phase);
  validateMonth(next);
  // Não gerar commit novo quando as informações canônicas não mudaram.
  const stripTime = object => {
    const copy = structuredClone(object); delete copy.updated_at; return JSON.stringify(copy);
  };
  if (stripTime(next) === stripTime(original)) return { changed: false, data: original };
  next.updated_at = now.toISOString();
  return { changed: true, data: next };
}

async function readJson(path, defaultValue) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return defaultValue;
    throw error;
  }
}
async function atomicWrite(path, data) {
  const tmp = path + '.tmp';
  try {
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

export async function persistWindow(root, patches, now = new Date()) {
  const base = join(root, 'data');
  const folder = join(base, 'months');
  await mkdir(folder, { recursive: true });
  const manifestPath = join(base, 'manifest.json');
  const existingManifest = validateManifest(await readJson(manifestPath, emptyManifest()));
  const grouped = new Map();
  for (const patch of patches) {
    const month = patch.coverage.date.slice(0, 7);
    if (!MONTH_RE.test(month)) throw Error('Data não corresponde a competência válida');
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month).push(patch);
  }
  const updatedMonths = [];
  for (const [month, list] of [...grouped.entries()].sort()) {
    const path = join(folder, month + '.json');
    const old = await readJson(path, emptyMonth(month));
    const next = mergeMonth(old, month, list, now);
    if (!next.changed) continue;
    await atomicWrite(path, JSON.stringify(next.data) + '\n');
    updatedMonths.push(month);
  }
  const months = [...new Set([...existingManifest.months, ...grouped.keys()])].sort();
  const nextManifest = {
    schema_version: VERSION, unit: UG,
    status: months.length ? 'dados_publicados' : 'aguardando_primeira_coleta',
    months,
    ...((updatedMonths.length || months.length !== existingManifest.months.length)
      ? { updated_at: now.toISOString() }
      : existingManifest.updated_at ? { updated_at: existingManifest.updated_at } : {})
  };
  if (JSON.stringify(nextManifest) !== JSON.stringify(existingManifest)) {
    validateManifest(nextManifest);
    await atomicWrite(manifestPath, JSON.stringify(nextManifest, null, 2) + '\n');
  }
  return { updatedMonths, months };
}

export async function validatePublishedData(root) {
  const base = join(root, 'data');
  const manifest = validateManifest(await readJson(join(base, 'manifest.json'), emptyManifest()));
  const months = [];
  for (const month of manifest.months) {
    const data = await readJson(join(base, 'months', month + '.json'), null);
    if (!data) throw Error('Manifesto aponta para mês inexistente');
    validateMonth(data);
    if (data.month !== month) throw Error('Competência do arquivo não corresponde ao manifesto');
    months.push(data);
  }
  // Bloqueia arquivos mensais órfãos não indexados que poderiam ficar públicos.
  try {
    const files = (await readdir(join(base, 'months'))).filter(name => name.endsWith('.json'));
    for (const filename of files) if (!manifest.months.includes(filename.slice(0, -5))) {
      throw Error('Arquivo mensal não indexado');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { manifest, months };
}

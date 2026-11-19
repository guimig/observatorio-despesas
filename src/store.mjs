/** Cache canônico mensal, idempotente e independente da produção do EmailBackupHub. */
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPublicSafe } from './privacy.mjs';
import { UG } from './cgu.mjs';
import { publicItemDescription } from './enrich-cgu.mjs';

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
    'documents', 'relations', 'coverage', 'beneficiaries', 'itemsByDocument', 'updated_at']);
  if (data.schema_version !== VERSION || data.unit !== UG || !MONTH_RE.test(data.month) ||
    data.source !== 'CGU' || !Array.isArray(data.documents) ||
    !Array.isArray(data.relations) || !Array.isArray(data.coverage)) {
    throw Error('Esquema mensal inválido');
  }
  if (data.beneficiaries !== undefined) {
    assertAllowedKeys(data.beneficiaries, Object.keys(data.beneficiaries));
    for (const [id, name] of Object.entries(data.beneficiaries)) {
      if (!/^\d{14}$/.test(id) || typeof name !== 'string' || name.length > 160) {
        throw Error('Cadastro público de pessoa jurídica inválido');
      }
    }
  }
  const ids = new Set();
  for (const doc of data.documents) {
    assertAllowedKeys(doc, ['id', 'date', 'phase', 'cents',
      'partyRef', 'cpfMasked', 'process', 'nature', 'paymentLinksChecked']);
    if (doc.paymentLinksChecked !== undefined &&
      (doc.phase !== 3 || doc.paymentLinksChecked !== true)) {
      throw Error('Marcador de consulta de pagamento inválido');
    }
    if (doc.partyRef !== undefined &&
        (!/^\d{14}$/.test(doc.partyRef) ||
          !Object.hasOwn(data.beneficiaries || {}, doc.partyRef))) {
      throw Error('CNPJ não encontrado no catálogo mensal');
    }
    if (doc.cpfMasked !== undefined &&
        (!/^\*\*\*\.\d{3}\.\d{3}-\*\*$/.test(doc.cpfMasked) ||
          doc.partyRef !== undefined)) {
      throw Error('CPF em formato diferente do mascaramento obrigatório');
    }
    if (doc.process !== undefined &&
        (typeof doc.process !== 'string' || doc.process.length > 90 ||
          !/^[A-Za-z0-9./\- ]+$/.test(doc.process))) {
      throw Error('Número de processo inválido');
    }
    if (doc.nature !== undefined) {
      assertAllowedKeys(doc.nature, ['group', 'element', 'program', 'action']);
      for (const value of Object.values(doc.nature)) {
        if (typeof value !== 'string' || !value || value.length > 120) {
          throw Error('Classificação de despesa inválida');
        }
      }
    }
    if (!validId(doc.id) || !DATE_RE.test(doc.date) ||
      !doc.date.startsWith(data.month) || !phases.has(doc.phase) || ids.has(doc.id)) {
      throw Error('Documento público inválido ou duplicado');
    }
    assertCents(doc.cents); ids.add(doc.id);
  }
  if (data.itemsByDocument !== undefined) {
    assertAllowedKeys(data.itemsByDocument, Object.keys(data.itemsByDocument));
    for (const [id, items] of Object.entries(data.itemsByDocument)) {
      const owner=data.documents.find(doc=>doc.id===id);
      if (!validId(id) || !id.includes('NE') || owner?.phase!==1 ||
          !Array.isArray(items) || items.length > 4000) {
        throw Error('Itens referem-se a empenho inexistente ou possuem formato incorreto');
      }
      const sequences=new Set();
      for (const item of items) {
        assertAllowedKeys(item, ['seq','code','sub','subdesc','description','cents']);
        if(!Number.isSafeInteger(item.seq)||item.seq<1||item.seq>100000||
           sequences.has(item.seq))throw Error('Sequência de item inválida ou duplicada');
        sequences.add(item.seq);
        for(const key of ['code','sub']){
          if(item[key]!==undefined&&
            (typeof item[key]!=='string'||!new RegExp('^[A-Za-z0-9_./-]{1,'+
              (key==='code'?80:20)+'}
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
    const previousDocs = next.documents.filter(doc =>
      doc.date === coverage.date && doc.phase === coverage.phase);
    const previousById = new Map(previousDocs.map(doc => [doc.id, doc]));
    const removedIds = new Set(previousDocs.map(doc => doc.id));
    const previousPaymentLinks = next.relations.filter(link =>
      removedIds.has(link.from));
    next.documents = next.documents.filter(doc =>
      !(doc.date === coverage.date && doc.phase === coverage.phase));
    next.relations = next.relations.filter(link => !removedIds.has(link.from));
    next.coverage = next.coverage.filter(c => c.date + '/' + c.phase !== key);
    const normalized = structuredClone(documents).map(doc => {
      if (!doc.beneficiary) return doc;
      if (doc.beneficiary.type === 'pj') {
        if (!next.beneficiaries) next.beneficiaries = {};
        const { id, name } = doc.beneficiary;
        if (!/^\d{14}$/.test(id)) throw Error('CNPJ público inválido');
        next.beneficiaries[id] = name || next.beneficiaries[id] || '';
        doc.partyRef = id;
      } else if (doc.beneficiary.type === 'pf') {
        doc.cpfMasked = doc.beneficiary.id;
      } else throw Error('Natureza de favorecido desconhecida');
      delete doc.beneficiary;
      return doc;
    });
    for (const doc of normalized) {
      const previousDoc=previousById.get(doc.id);
      if (!previousDoc || previousDoc.cents !== doc.cents) {
        // O enriquecimento de um documento retificado deve ser reconsultado.
        if (doc.phase === 1 && next.itemsByDocument) {
          delete next.itemsByDocument[doc.id];
        }
        continue;
      }
      if (doc.phase === 3 && previousDoc.paymentLinksChecked === true) {
        doc.paymentLinksChecked = true;
        next.relations.push(...previousPaymentLinks.filter(link => link.from === doc.id));
      }
    }
    next.documents.push(...normalized);
    next.relations.push(...structuredClone(links));
    next.coverage.push(structuredClone(coverage));
  }
  if (next.itemsByDocument) {
    const available = new Set(next.documents.filter(doc => doc.phase===1).map(doc=>doc.id));
    next.itemsByDocument = Object.fromEntries(
      Object.entries(next.itemsByDocument).filter(([id]) => available.has(id))
        .sort(([a],[b])=>a.localeCompare(b)));
    if (!Object.keys(next.itemsByDocument).length) delete next.itemsByDocument;
  }
  if (next.beneficiaries) {
    const used = new Set(next.documents.map(doc => doc.partyRef).filter(Boolean));
    next.beneficiaries = Object.fromEntries(Object.entries(next.beneficiaries)
      .filter(([id]) => used.has(id)).sort(([a], [b]) => a.localeCompare(b)));
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

/**
 * Enriquecimento por identificador sem repetir consultas/documentos e sem misturar
 * ciclos de atualização dos atributos documentais com os de detalhes.
 */
export function applyDocumentEnrichment(existing,id,result,now=new Date()) {
  const original=validateMonth(structuredClone(existing));
  const doc=original.documents.find(item=>item.id===id);
  if(!doc)throw Error('Documento de enriquecimento não encontrado');
  const next=structuredClone(original);
  const target=next.documents.find(item=>item.id===id);
  if(result.kind==='payment'){
    if(target.phase!==3||!Array.isArray(result.links))throw Error('Vínculo de pagamento inválido');
    if(result.links.some(link=>link.from!==id))throw Error('Vínculo pertence a documento diferente');
    target.paymentLinksChecked=true;
    next.relations=next.relations.filter(link=>link.from!==id);
    next.relations.push(...structuredClone(result.links));
    next.relations.sort((a,b)=>a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) || a.cents-b.cents);
  }else if(result.kind==='items'){
    if(target.phase!==1||!Array.isArray(result.items))throw Error('Itens de empenho inválidos');
    if(!next.itemsByDocument)next.itemsByDocument={};
    next.itemsByDocument[id]=structuredClone(result.items);
    next.itemsByDocument=Object.fromEntries(Object.entries(next.itemsByDocument)
      .sort(([a],[b])=>a.localeCompare(b)));
  }else throw Error('Tipo de enriquecimento não autorizado');
  validateMonth(next);
  const stripTime=x=>{const d=structuredClone(x);delete d.updated_at;return JSON.stringify(d)};
  if(stripTime(next)===stripTime(original))return {changed:false,data:original};
  next.updated_at=now.toISOString();
  return {changed:true,data:next};
}

export async function persistEnrichment(root,month,id,result,now=new Date()){
  if(!MONTH_RE.test(month))throw Error('Competência inválida');
  const path=join(root,'data','months',month+'.json');
  const current=await readJson(path,null);
  if(!current)throw Error('Competência sem JSON');
  const outcome=applyDocumentEnrichment(current,id,result,now);
  if(outcome.changed)await atomicWrite(path,JSON.stringify(outcome.data)+'\n');
  return outcome.changed;
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
).test(item[key]))) {
            throw Error('Código de item inválido');
          }
        }
        for(const [key,max] of [['subdesc',110],['description',260]]){
          if(item[key]!==undefined && publicItemDescription(item[key],max)!==item[key]){
            throw Error('Texto de item não sanitizado');
          }
        }
        if(item.cents!==undefined && !Number.isSafeInteger(item.cents)) {
          throw Error('Valor de item inválido');
        }
      }
    }
  }
  const linkPairs=new Set();
  for (const link of data.relations) {
    assertAllowedKeys(link, ['from', 'to', 'cents']);
    const source=data.documents.find(doc=>doc.id===link.from);
    if (!validId(link.from) || !validId(link.to) || !link.to.includes('NE') ||
        !ids.has(link.from) || ![2,3].includes(source?.phase)) {
      throw Error('Vínculo documental inválido');
    }
    const pair=link.from+'/'+link.to;
    if(linkPairs.has(pair))throw Error('Vínculo documental duplicado');
    linkPairs.add(pair);
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
    const normalized = structuredClone(documents).map(doc => {
      if (!doc.beneficiary) return doc;
      if (doc.beneficiary.type === 'pj') {
        if (!next.beneficiaries) next.beneficiaries = {};
        const { id, name } = doc.beneficiary;
        if (!/^\d{14}$/.test(id)) throw Error('CNPJ público inválido');
        next.beneficiaries[id] = name || next.beneficiaries[id] || '';
        doc.partyRef = id;
      } else if (doc.beneficiary.type === 'pf') {
        doc.cpfMasked = doc.beneficiary.id;
      } else throw Error('Natureza de favorecido desconhecida');
      delete doc.beneficiary;
      return doc;
    });
    next.documents.push(...normalized);
    next.relations.push(...structuredClone(links));
    next.coverage.push(structuredClone(coverage));
  }
  if (next.beneficiaries) {
    const used = new Set(next.documents.map(doc => doc.partyRef).filter(Boolean));
    next.beneficiaries = Object.fromEntries(Object.entries(next.beneficiaries)
      .filter(([id]) => used.has(id)).sort(([a], [b]) => a.localeCompare(b)));
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

/** Cache canônico mensal, idempotente e independente da produção do EmailBackupHub. */
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPublicSafe } from './privacy.mjs';
import { UG, CGU_NATURE_FIELDS } from './cgu.mjs';
import { publicItemDescription } from './enrich-cgu.mjs';
import {publicNarrativeText} from './public-narrative.mjs';
import {officialDecimal,movementClass} from './item-movements.mjs';
import {inScopeRelatedDocument,validRelatedPair} from '../assets/trajectory.js';

export const VERSION = 1;
const DOCUMENT_RE = /^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/;
const NE_RE = /^158459\d{5}20\d{2}NE\d{6}$/;
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
    'documents', 'relations', 'coverage', 'phaseObservations', 'commitmentObservations', 'beneficiaries', 'itemsByDocument', 'updated_at']);
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
      'partyRef', 'cpfMasked', 'process', 'nature', 'natureCheckedAt', 'paymentLinksChecked',
      'liquidationLinksChecked', 'description', 'descriptionCheckedAt', 'itemsDetailVersion', 'valueSource','relatedIds']);
    if(doc.relatedIds!==undefined){
      const phase={NE:1,NS:2,OB:3,DF:3}[doc.id?.slice(15,17)];
      if(!inScopeRelatedDocument(doc.id)||phase!==doc.phase||!Array.isArray(doc.relatedIds)||
         doc.relatedIds.length>3000||new Set(doc.relatedIds).size!==doc.relatedIds.length||
         doc.relatedIds.some(other=>!validRelatedPair(doc.id,other)))
        throw Error('Identidades de documentos relacionados invalidas');
    }
    if(doc.itemsDetailVersion!==undefined&&doc.itemsDetailVersion!==2)
      throw Error('Versao de enriquecimento de itens invalida');
    if(doc.itemsDetailVersion===2&&!Object.hasOwn(data.itemsByDocument||{},doc.id))
      throw Error('Versao de itens sem catalogo');
    if(doc.natureCheckedAt!==undefined &&
      (typeof doc.natureCheckedAt!=='string'||!DATE_RE.test(doc.natureCheckedAt)))
      throw Error('Revisao de classificacao invalida');
    if(doc.descriptionCheckedAt!==undefined &&
      (typeof doc.descriptionCheckedAt!=='string'||!DATE_RE.test(doc.descriptionCheckedAt)))
      throw Error('Revisão narrativa documental inválida');
    if(doc.description!==undefined && publicNarrativeText(doc.description)!==doc.description)
      throw Error('Descrição de documento não sanitizada');
    if (doc.paymentLinksChecked !== undefined &&
        (doc.phase !== 3 || doc.paymentLinksChecked !== true)) {
      throw Error('Marcador de consulta de pagamento inválido');
    }
    if (doc.liquidationLinksChecked !== undefined &&
        (doc.phase !== 2 || doc.liquidationLinksChecked !== true)) {
      throw Error('Marcador de consulta de liquidação inválido');
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
      assertAllowedKeys(doc.nature, Object.keys(CGU_NATURE_FIELDS));
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
    assertCents(doc.cents);
    if(doc.valueSource!==undefined&&(doc.valueSource!=='impactos_cgu'||doc.phase!==2||doc.cents===null))
      throw Error('Proveniencia monetaria invalida');
    ids.add(doc.id);
  }
  // A aparicao em outro filtro da API nao constitui outro documento nem
  // comprova uma nova operacao de liquidacao/pagamento.
  const appearances=data.phaseObservations||[];
  if(!Array.isArray(appearances))throw Error('Aparicoes em fases invalidas');
  const appearanceKeys=new Set();
  for(const item of appearances){
    assertAllowedKeys(item,['id','date','phase','amountKnown','amountRelation']);
    const owner=data.documents.find(doc=>doc.id===item.id);
    const key=item.id+'/'+item.date+'/'+item.phase;
    if(!owner||owner.date!==item.date||!phases.has(item.phase)||
       owner.phase===item.phase||typeof item.amountKnown!=='boolean'||
       !['same','different','unknown'].includes(item.amountRelation)||
       ((!item.amountKnown||owner.cents===null)&&item.amountRelation!=='unknown')||
       appearanceKeys.has(key))throw Error('Aparicao documental em fase invalida');
    appearanceKeys.add(key);
  }
  // Reaparecimento de uma NE em outra data da listagem: evidencia, nao documento/operacao.
  const commitmentObservations=data.commitmentObservations||[];
  if(!Array.isArray(commitmentObservations))throw Error('Observacoes de data de NE invalidas');
  const commitmentKeys=new Set();
  for(const item of commitmentObservations){
    assertAllowedKeys(item,['id','date','ownerDate','cents']);
    const key=item.id+'/'+item.date;
    const owner=data.documents.find(doc=>doc.id===item.id&&doc.phase===1&&doc.date===item.ownerDate);
    if(!NE_RE.test(item.id)||!DATE_RE.test(item.date)||!DATE_RE.test(item.ownerDate)||
       !item.date.startsWith(data.month)||item.ownerDate===item.date||
       (item.ownerDate.startsWith(data.month)&&!owner)||
       data.documents.some(doc=>doc.id===item.id&&doc.date===item.date)||
       commitmentKeys.has(key))throw Error('Observacao de data de NE invalida');
    assertCents(item.cents);
    commitmentKeys.add(key);
  }
  if (data.itemsByDocument !== undefined) {
    if (!data.itemsByDocument || typeof data.itemsByDocument !== 'object' ||
        Array.isArray(data.itemsByDocument)) throw Error('Catálogo de itens inválido');
    for (const [id, items] of Object.entries(data.itemsByDocument)) {
      const owner = data.documents.find(doc=>doc.id===id);
      if (!NE_RE.test(id) || owner?.phase !== 1 || !Array.isArray(items) ||
          items.length > 4000) throw Error('Itens sem empenho de origem válido');
      const sequences=new Set();
      for (const item of items) {
        assertAllowedKeys(item, ['seq','code','sub','subdesc','description','purchaseItem','cents',
          'movements','historyChecked','historyCheckedAt']);
        if(item.historyCheckedAt!==undefined&&
          (item.historyChecked!==true||!DATE_RE.test(item.historyCheckedAt)))
          throw Error('Checkpoint historico invalido');
        if(item.purchaseItem!==undefined&&!/^\d{1,8}$/.test(item.purchaseItem))
          throw Error('Numero de item da compra invalido');
        if(item.historyChecked!==undefined&&item.historyChecked!==true)
          throw Error('Marcador de historico invalido');
        if(item.movements!==undefined){
          if(item.historyChecked!==true||!Array.isArray(item.movements)||item.movements.length>500)
            throw Error('Lista de movimentacoes invalida');
          for(const m of item.movements){
            assertAllowedKeys(m,['date','operation','type','quantity','unitPrice','cents']);
            if(!DATE_RE.test(m.date)||publicNarrativeText(m.operation,120)!==m.operation||
              movementClass(m.operation)!==m.type||
              officialDecimal(m.quantity)!==m.quantity||
              officialDecimal(m.unitPrice)!==m.unitPrice||!Number.isSafeInteger(m.cents))
              throw Error('Movimentacao de item invalida');
          }
        }
        if(item.historyChecked===true&&!Array.isArray(item.movements))
          throw Error('Consulta historica sem dados de cobertura');
        if (!Number.isSafeInteger(item.seq) || item.seq < 1 || item.seq > 100000 ||
            sequences.has(item.seq)) throw Error('Sequencial de item inválido');
        sequences.add(item.seq);
        for (const key of ['code','sub']) {
          const regex = key==='code' ? /^[A-Za-z0-9_./-]{1,80}$/ : /^[A-Za-z0-9_./-]{1,20}$/;
          if (item[key] !== undefined &&
              (typeof item[key] !== 'string' || !regex.test(item[key]))) {
            throw Error('Código de item inválido');
          }
        }
        if(item.subdesc!==undefined&&publicItemDescription(item.subdesc,110)!==item.subdesc)
          throw Error('Subelemento nao sanitizado');
        if(item.description!==undefined&&publicNarrativeText(item.description,5000)!==item.description)
          throw Error('Descricao de item nao sanitizada');
        if (item.cents !== undefined && !Number.isSafeInteger(item.cents)) {
          throw Error('Valor monetário de item inválido');
        }
      }
    }
  }
  const relationPairs=new Set();
  for (const link of data.relations) {
    assertAllowedKeys(link, ['from', 'to', 'cents']);
    const source=data.documents.find(doc=>doc.id===link.from);
    if (!validId(link.from) || !NE_RE.test(link.to) || !ids.has(link.from) ||
        ![2,3].includes(source?.phase)) throw Error('Vínculo documental inválido');
    const pair=link.from+'/'+link.to;
    if (relationPairs.has(pair)) throw Error('Vínculo documental duplicado');
    relationPairs.add(pair);
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
      (c.reason !== undefined && !['limite_paginas', 'pagina_repetida', 'consulta_individual'].includes(c.reason)) ||
      (c.unlinked !== undefined && (!Number.isSafeInteger(c.unlinked) || c.unlinked < 0))) {
      throw Error('Cobertura documental inválida');
    }
    const key = c.date + '/' + c.phase;
    if (keys.has(key)) throw Error('Cobertura documental duplicada');
    keys.add(key);
    const matched = data.documents.filter(doc => doc.date === c.date && doc.phase === c.phase);
    const additional=appearances.filter(item=>item.date===c.date&&item.phase===c.phase);
    const dated=c.phase===1?commitmentObservations.filter(item=>item.date===c.date):[];
    if (matched.length+additional.length+dated.length !== c.count ||
        matched.filter(doc => doc.cents === null).length+
          additional.filter(item=>!item.amountKnown).length+dated.filter(item=>item.cents===null).length !== c.invalid) {
      throw Error('Contagem documental divergente');
    }
    if (c.complete && c.reason) throw Error('Consulta completa com motivo parcial');
  }
  for (const doc of data.documents) {
    if (!keys.has(doc.date + '/' + doc.phase)) throw Error('Documento sem cobertura declarada');
  }
  for(const item of appearances){
    if(!keys.has(item.date+'/'+item.phase))throw Error('Aparicao sem cobertura declarada');
  }
  for(const item of commitmentObservations){
    if(!keys.has(item.date+'/1'))throw Error('Observacao de data de NE sem cobertura');
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

export function indexCommitmentOwners(months){
  const owners=new Map();
  for(const m of months)for(const doc of m.documents){
    if(doc.phase!==1||!NE_RE.test(doc.id))continue;
    if(!owners.has(doc.id))owners.set(doc.id,[]);
    owners.get(doc.id).push(doc);
  }
  return owners;
}
export function mergeMonth(existing, month, patches, now = new Date(), {commitmentOwners=null}={}) {
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
    const previousDocs=next.documents.filter(doc =>
      doc.date===coverage.date && doc.phase===coverage.phase);
    const previousById=new Map(previousDocs.map(doc=>[doc.id,doc]));
    const incomingIds=new Set(documents.map(doc=>doc.id));
    const oldObservations=(next.commitmentObservations||[]).filter(o=>o.date===coverage.date&&coverage.phase===1);
    if(incomingIds.size!==documents.length)throw Error('Documento duplicado no mesmo filtro');
    // Uma lista CGU posterior pode deixar de trazer uma NE sem que ela tenha
    // desaparecido. Preservar o checkpoint anterior, sem afirmar nova cobertura.
    if(commitmentOwners&&coverage.phase===1&&
       (previousDocs.some(d=>NE_RE.test(d.id)&&!incomingIds.has(d.id))||
        oldObservations.some(o=>!incomingIds.has(o.id)))){
      if(!coverage.complete)continue;
      const error=Error('Listagem omitiu NE anteriormente observada');
      error.code='CGU_NE_LISTING_CHANGED';throw error;
    }
    // Coleta diaria parcial nunca elimina NE consultada individualmente,
    // mesmo quando trouxe mais linhas; somente dia completo pode reconciliar.
    if(!coverage.complete&&previousDocs.some(doc=>!incomingIds.has(doc.id)))
      continue;
    if(coverage.complete&&previous?.reason==='consulta_individual'&&
       previousDocs.some(doc=>!incomingIds.has(doc.id)))
      throw Error('Dia completo nao contem NE recuperada individualmente');
    if(previousDocs.some(doc=>!incomingIds.has(doc.id)&&
       (next.phaseObservations||[]).some(item=>item.id===doc.id))){
      throw Error('Documento de origem referenciado por outra fase: revisar retificacao');
    }
    const removedIds=new Set(previousDocs.map(doc=>doc.id));
    const previousLinks=next.relations.filter(link=>removedIds.has(link.from));
    const incomingOrigins=new Set(links.map(link=>link.from));
    const carriedOrigins=new Set();
    next.documents = next.documents.filter(doc =>
      !(doc.date === coverage.date && doc.phase === coverage.phase));
    next.relations = next.relations.filter(link => !removedIds.has(link.from));
    next.coverage = next.coverage.filter(c => c.date + '/' + c.phase !== key);
    next.phaseObservations=(next.phaseObservations||[]).filter(item=>
      !(item.date===coverage.date&&item.phase===coverage.phase));
    next.commitmentObservations=(next.commitmentObservations||[]).filter(o=>
      !(coverage.phase===1&&o.date===coverage.date));
    const normalized=[];
    for(const doc of structuredClone(documents)){
      if(commitmentOwners&&doc.phase===1&&NE_RE.test(doc.id)){
        const candidates=[...next.documents.filter(d=>d.id===doc.id&&d.phase===1),
          ...(commitmentOwners.get(doc.id)||[]).filter(d=>!d.date.startsWith(month))];
        if(candidates.length>1)throw Error('Documento em datas diferentes exige revisao');
        const prior=candidates[0];
        if(prior&&prior.date!==doc.date){
          // Nao mover o proprietario, atualizar seu valor pela data da lista,
          // nem converter diferenca entre valores em reforco/anulacao.
          next.commitmentObservations.push({id:doc.id,date:doc.date,ownerDate:prior.date,cents:doc.cents});
          continue;
        }
      }
      const owner=next.documents.find(entry=>entry.id===doc.id);
      if(owner){
        if(owner.date!==doc.date)throw Error('Documento em datas diferentes exige revisao');
        if(owner.phase===doc.phase)throw Error('Documento duplicado no mesmo filtro');
        const amountKnown=doc.cents!==null;
        const amountRelation=!amountKnown||owner.cents===null?'unknown':
          doc.cents===owner.cents?'same':'different';
        next.phaseObservations.push({
          id:doc.id,date:doc.date,phase:doc.phase,amountKnown,amountRelation
        });
        continue;
      }
      if(doc.beneficiary?.type==='pj'){
        if(!next.beneficiaries)next.beneficiaries={};
        const {id,name}=doc.beneficiary;
        if(!/^\d{14}$/.test(id))throw Error('CNPJ público inválido');
        next.beneficiaries[id]=name||next.beneficiaries[id]||'';
        doc.partyRef=id;
      }else if(doc.beneficiary?.type==='pf'){
        doc.cpfMasked=doc.beneficiary.id;
      }else if(doc.beneficiary){
        throw Error('Natureza de favorecido desconhecida');
      }
      delete doc.beneficiary;
      const old=previousById.get(doc.id);
      // Campos omitidos em nova listagem nao apagam classificacao oficial ja coletada.
      // Nao herdar de outro documento, fase ou identidade.
      if(old?.nature){
        const prior={...old.nature};
        // PO e localizador dependem da acao; alteracao de contexto invalida os anteriores.
        if(['action','program','function','subfunction'].some(key=>
           doc.nature?.[key]!==undefined&&doc.nature[key]!==prior[key])){
          delete prior.budgetPlan;delete prior.locator;delete prior.subtitle;
        }
        doc.nature={...prior,...doc.nature};
      }
      if(old?.relatedIds!==undefined&&old.phase===doc.phase&&old.date===doc.date&&doc.relatedIds===undefined)
        doc.relatedIds=structuredClone(old.relatedIds);
      if(old?.natureCheckedAt&&!doc.natureCheckedAt&&
        JSON.stringify(old.nature||{})===JSON.stringify(doc.nature||{}))doc.natureCheckedAt=old.natureCheckedAt;
      if(old?.description&&!doc.description)doc.description=old.description;
      if(old?.descriptionCheckedAt&&!doc.descriptionCheckedAt)
        doc.descriptionCheckedAt=old.descriptionCheckedAt;
      if(old?.itemsDetailVersion===2&&old.cents===doc.cents)
        doc.itemsDetailVersion=2;
      normalized.push(doc);
    }
    for (const doc of normalized) {
      const before=previousById.get(doc.id);
      if (!before || before.cents !== doc.cents) {
        // Não reutilizar comparação de valor anterior a uma retificação.
        if(before?.cents!==doc.cents){
          for(const item of next.phaseObservations||[]){
            if(item.id===doc.id)item.amountRelation='unknown';
          }
        }
        // Dados retificados exigem nova consulta dos itens/vínculos.
        if(doc.phase===1){
          delete doc.itemsDetailVersion;
          if(next.itemsByDocument)delete next.itemsByDocument[doc.id];
        }
        continue;
      }
      const prior=previousLinks.filter(link=>link.from===doc.id);
      if (doc.phase===2 &&
          (before.liquidationLinksChecked===true || !incomingOrigins.has(doc.id))) {
        if(before.liquidationLinksChecked===true)doc.liquidationLinksChecked=true;
        next.relations.push(...prior);
        if(prior.length)carriedOrigins.add(doc.id);
      }
      if (doc.phase===3 && before.paymentLinksChecked===true) {
        doc.paymentLinksChecked=true;
        next.relations.push(...prior);
        if(prior.length)carriedOrigins.add(doc.id);
      }
    }
    next.documents.push(...normalized);
    const canonicalIds=new Set(normalized.map(doc=>doc.id));
    next.relations.push(...structuredClone(links.filter(link=>
      canonicalIds.has(link.from)&&!carriedOrigins.has(link.from))));
    next.coverage.push(structuredClone(coverage));
  }
  if (next.itemsByDocument) {
    const available=new Set(next.documents.filter(doc=>doc.phase===1).map(doc=>doc.id));
    next.itemsByDocument=Object.fromEntries(Object.entries(next.itemsByDocument)
      .filter(([id])=>available.has(id)).sort(([a],[b])=>a.localeCompare(b)));
    if (!Object.keys(next.itemsByDocument).length) delete next.itemsByDocument;
  }
  if (next.beneficiaries) {
    const used = new Set(next.documents.map(doc => doc.partyRef).filter(Boolean));
    next.beneficiaries = Object.fromEntries(Object.entries(next.beneficiaries)
      .filter(([id]) => used.has(id)).sort(([a], [b]) => a.localeCompare(b)));
  }
  next.documents.sort((a, b) => a.date.localeCompare(b.date) ||
    a.phase - b.phase || a.id.localeCompare(b.id));
  if(next.phaseObservations?.length)next.phaseObservations.sort((a,b)=>
    a.date.localeCompare(b.date)||a.phase-b.phase||a.id.localeCompare(b.id));
  else delete next.phaseObservations;
  if(next.commitmentObservations?.length)next.commitmentObservations.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  else delete next.commitmentObservations;
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
 * Acrescenta uma NE cuja identidade e data de emissao foram verificadas
 * por consulta individual CGU. NAO declara o dia como consulta completa.
 * Nao apaga outros documentos da fase, itens, relacoes ou fornecedores.
 */
export function applyTargetedOriginal(existing,document,now=new Date()){
  if(document?.phase!==1||!NE_RE.test(document.id))throw Error('NE individual sem identidade e data verificadas');
  return applyTargetedDocument(existing,document,now);
}
/** Consulta individual por identidade; nao comprova cobertura diaria ou impacto por NE. */
export function applyTargetedDocument(existing,document,now=new Date()){
  const expected={NE:1,NS:2,OB:3,DF:3}[document?.id?.slice(15,17)];
  if(!document||!inScopeRelatedDocument(document.id)||document.phase!==expected||
     !DATE_RE.test(document.date)||document.id.slice(11,15)!==document.date.slice(0,4)||
     !(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw Error('NE individual sem identidade e data verificadas');
  const month=document.date.slice(0,7);
  const original=validateMonth(structuredClone(existing||emptyMonth(month)));
  if(original.month!==month)throw Error('Competencia individual divergente');
  const old=original.documents.find(d=>d.id===document.id);
  if(old){
    if(old.date!==document.date||old.phase!==document.phase)
      throw Error('Documento individual com data ou fase divergente');
    return {changed:false,data:original};
  }
  const next=structuredClone(original);
  const coverage=next.coverage.find(c=>c.date===document.date&&c.phase===document.phase);
  // Se a fonte ja afirma cobertura integral do dia e o documento nao consta,
  // existe conflito real de origem; nunca sobrescrever o dia validado.
  if(coverage?.complete===true)
    throw Error('Dia CGU ja completo sem NE individual: revisar fonte');
  const doc=structuredClone(document);
  if(doc.beneficiary?.type==='pj'){
    const {id,name}=doc.beneficiary;
    if(!/^\d{14}$/.test(id))throw Error('Fornecedor de NE invalido');
    next.beneficiaries ||= {};
    next.beneficiaries[id]=name||next.beneficiaries[id]||'';
    doc.partyRef=id;
  }else if(doc.beneficiary?.type==='pf'){
    doc.cpfMasked=doc.beneficiary.id;
  }else if(doc.beneficiary){
    throw Error('Beneficiario de NE individual invalido');
  }
  delete doc.beneficiary;
  next.documents.push(doc);
  next.documents.sort((a,b)=>a.date.localeCompare(b.date)||
    a.phase-b.phase||a.id.localeCompare(b.id));
  if(coverage){
    coverage.count++;
    if(doc.cents===null)coverage.invalid++;
    coverage.reason ||= 'consulta_individual';
  }else{
    next.coverage.push({date:doc.date,phase:doc.phase,complete:false,count:1,
      invalid:doc.cents===null?1:0,reason:'consulta_individual'});
    next.coverage.sort((a,b)=>a.date.localeCompare(b.date)||a.phase-b.phase);
  }
  if(next.beneficiaries){
    next.beneficiaries=Object.fromEntries(Object.entries(next.beneficiaries)
      .sort(([a],[b])=>a.localeCompare(b)));
  }
  validateMonth(next);
  next.updated_at=now.toISOString();
  return {changed:true,data:next};
}

/** Atualiza detalhes independentes da consulta documental, com idempotência. */
export function applyDocumentEnrichment(existing,id,result,now=new Date()){
  const original=validateMonth(structuredClone(existing));
  const doc=original.documents.find(item=>item.id===id);
  if(!doc)throw Error('Documento não encontrado no JSON mensal');
  const next=structuredClone(original);
  const target=next.documents.find(item=>item.id===id);
  if(result.kind==='relatedDocuments'){
    if(!Array.isArray(result.ids)||result.ids.some(other=>!validRelatedPair(id,other)))
      throw Error('Identidades relacionadas invalidas');
    if((target.relatedIds||[]).some(other=>!result.ids.includes(other)))
      throw Error('Consulta de relacionados omitiu vinculo previamente identificado');
    target.relatedIds=[...new Set(result.ids)].sort();
  }else if(result.kind==='liquidationValue'){
    if(target.phase!==2||!Array.isArray(result.links)||!result.links.length||
       result.links.some(link=>link.from!==id||!Number.isSafeInteger(link.cents))||
       !Number.isSafeInteger(result.cents)||result.links.reduce((n,l)=>n+BigInt(l.cents),0n)!==BigInt(result.cents))
      throw Error('Valor de liquidacao sem impactos completos e identificados');
    // Recuperacao de lacuna, nunca retificacao de valor documental existente.
    if(target.cents!==null)return {changed:false,data:original};
    const coverage=next.coverage.find(c=>c.date===target.date&&c.phase===2);
    if(!coverage?.complete||coverage.invalid<1)throw Error('Listagem da fase ainda nao concluida');
    target.cents=result.cents;target.valueSource='impactos_cgu';target.liquidationLinksChecked=true;
    coverage.invalid--;
    next.relations=next.relations.filter(link=>link.from!==id);
    next.relations.push(...structuredClone(result.links));
    next.relations.sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.cents-b.cents);
    // Uma aparicao em outro filtro nao ganha valor ou igualdade presumida.
    for(const o of next.phaseObservations||[])if(o.id===id)o.amountRelation='unknown';
  }else if(result.kind==='liquidation'){
    if(target.phase!==2||!Array.isArray(result.links)||
       result.links.some(link=>link.from!==id))throw Error('Vínculos de liquidação inválidos');
    if(!result.links.length&&next.relations.some(link=>link.from===id))
      throw Error('Consulta vazia não pode apagar vínculos de liquidação anteriores');
    target.liquidationLinksChecked=true;
    next.relations=next.relations.filter(link=>link.from!==id);
    next.relations.push(...structuredClone(result.links));
    next.relations.sort((a,b)=>a.from.localeCompare(b.from)||
      a.to.localeCompare(b.to)||a.cents-b.cents);
  }else if(result.kind==='payment'){
    if(target.phase!==3||!Array.isArray(result.links)||
       result.links.some(link=>link.from!==id))throw Error('Vínculos de pagamento inválidos');
    if(target.paymentLinksChecked===true&&!result.links.length&&next.relations.some(link=>link.from===id))
      throw Error('Reconsulta vazia nao pode apagar vinculos de pagamento confirmados');
    target.paymentLinksChecked=true;
    next.relations=next.relations.filter(link=>link.from!==id);
    next.relations.push(...structuredClone(result.links));
    next.relations.sort((a,b)=>a.from.localeCompare(b.from)||
      a.to.localeCompare(b.to)||a.cents-b.cents);
  }else if(result.kind==='items'){
    if(target.phase!==1||!Array.isArray(result.items))throw Error('Itens de empenho inválidos');
    next.itemsByDocument ||= {};
    const previous=new Map((next.itemsByDocument[id]||[]).map(item=>[item.seq,item]));
    if(result.recheck&&[...previous.keys()].some(seq=>!result.items.some(item=>item.seq===seq)))
      throw Error('Reconsulta de itens omitiu sequencial confirmado; revisar fonte');
    next.itemsByDocument[id]=structuredClone(result.items).map(item=>{
      const old=previous.get(item.seq);
      if(old?.historyChecked===true&&old.cents===item.cents){
        item.historyChecked=true;item.movements=structuredClone(old.movements);
        if(old.historyCheckedAt)item.historyCheckedAt=old.historyCheckedAt;
      }
      return item;
    });
    target.itemsDetailVersion=2;
    next.itemsByDocument=Object.fromEntries(Object.entries(next.itemsByDocument)
      .sort(([a],[b])=>a.localeCompare(b)));
  }else if(result.kind==='itemHistory'){
    if(target.phase!==1||!Number.isSafeInteger(result.seq)||
       !Array.isArray(result.movements)||!next.itemsByDocument?.[id])
      throw Error('Historico sem item de empenho consultado');
    const item=next.itemsByDocument[id].find(row=>row.seq===result.seq);
    if(!item)throw Error('Sequencial de historico nao encontrado');
    if(item.historyChecked===true&&Array.isArray(item.movements)&&item.movements.length){
      if(!result.movements.length)throw Error('Reconsulta vazia nao apaga historico confirmado');
      const previous=new Set(item.movements.map(m=>JSON.stringify(m)));
      const current=new Set(result.movements.map(m=>JSON.stringify(m)));
      if([...previous].some(key=>!current.has(key)))
        throw Error('Historico divergente exige revisao, sem sobrescrever eventos anteriores');
    }
    item.historyChecked=true;
    item.movements=structuredClone(result.movements);
    if(result.checkedAt)item.historyCheckedAt=result.checkedAt;
  }else throw Error('Tipo de enriquecimento não permitido');
  validateMonth(next);
  const withoutTimestamp=value=>{
    const copy=structuredClone(value);delete copy.updated_at;
    return JSON.stringify(copy);
  };
  if(withoutTimestamp(next)===withoutTimestamp(original))return {changed:false,data:original};
  next.updated_at=now.toISOString();
  return {changed:true,data:next};
}

export async function persistEnrichment(root,month,id,result,now=new Date()){
  if(!MONTH_RE.test(month))throw Error('Competência inválida');
  const path=join(root,'data','months',month+'.json');
  const current=await readJson(path,null);
  if(!current)throw Error('Arquivo da competência inexistente');
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

/** Arquivo mensal + manifesto canonico, sem marcar cobertura integral. */
export async function persistTargetedOriginal(root,document,now=new Date()){
  if(document?.phase!==1||!NE_RE.test(document.id))throw Error('NE individual invalida');
  return persistTargetedDocument(root,document,now);
}
export async function persistTargetedDocument(root,document,now=new Date()){
  if(!document||typeof document.date!=='string')
    throw Error('NE individual invalida');
  const month=document.date.slice(0,7);
  if(!MONTH_RE.test(month))throw Error('Mes de origem invalido');
  const base=join(root,'data'),folder=join(base,'months');
  const manifestPath=join(base,'manifest.json');
  const manifest=validateManifest(await readJson(manifestPath,emptyManifest()));
  const path=join(folder,month+'.json');
  const existing=await readJson(path,null);
  const outcome=applyTargetedDocument(existing,document,now);
  if(!outcome.changed)return {changed:false,month};
  const months=[...new Set([...manifest.months,month])].sort();
  const nextManifest={schema_version:VERSION,unit:UG,status:'dados_publicados',
    months,updated_at:now.toISOString()};
  validateManifest(nextManifest);
  await mkdir(folder,{recursive:true});
  await atomicWrite(path,JSON.stringify(outcome.data)+'\n');
  if(JSON.stringify(nextManifest)!==JSON.stringify(manifest))
    await atomicWrite(manifestPath,JSON.stringify(nextManifest,null,2)+'\n');
  return {changed:true,month};
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
  // Consultas de NE exigem identidade global, inclusive entre competencias.
  const working=new Map();
  if(patches.some(p=>p.coverage.phase===1)){
    for(const m of existingManifest.months)
      working.set(m,validateMonth(await readJson(join(folder,m+'.json'),null)));
  }
  for (const [month, list] of [...grouped.entries()].sort()) {
    const path = join(folder, month + '.json');
    const old = await readJson(path, emptyMonth(month));
    const next = mergeMonth(old, month, list, now,{commitmentOwners:indexCommitmentOwners([...working.values()])});
    working.set(month,next.data);
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
  const owners=indexCommitmentOwners(months);
  for(const m of months)for(const o of m.commitmentObservations||[]){
    if(!(owners.get(o.id)||[]).some(d=>d.date===o.ownerDate))
      throw Error('Observacao de data de NE sem documento de referencia');
  }
  return { manifest, months };
}

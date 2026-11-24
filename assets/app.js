import {filterStructuredNotice,filterStructuredContract,parseReaisFilter} from './procurement-structured-filters.js';
import { matchDocumentContract, assessContractAttribution, assessNoticeAttribution } from './procurement-links.js';
import {procurementFinancialEvidence,procurementEvidenceDetails} from './procurement-financial-evidence.js';
import {summarizeProcurementEvidence} from './procurement-evidence-coverage.js';
import {auditProcurementReferences} from './procurement-evidence-audit.js';
import {filterAuditFindings,auditFindingsCsv} from './procurement-audit-report.js';
import { MODALITIES } from './pncp-modalities.js';
import { isFormalContract,groupPublishedInstruments,summarizeInstrumentTypes } from './instrument-types.js';
import { documentSpecies,financialPhaseDescription } from './document-species.js';
import {showDialogFromTop} from './dialog-scroll.js';
import {auditSiafiItemMovements} from './siafi-movement-audit.js';
import {reconcileSiafiCommitment} from './siafi-movement-reconciliation.js';
import { auditMonth } from './quality.js';
import { buildCommitmentTrajectories, filterCommitmentTrajectories, auditCommitmentTrajectories } from './trajectory.js';
/** Visualização local de JSONs públicos. Não consulta APIs autenticadas. */
const $ = id => document.getElementById(id);
const fmtMoney = cents => Number.isSafeInteger(cents)
  ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
  : 'Indisponível';
const fmtCount = n => new Intl.NumberFormat('pt-BR').format(n);
const phaseNames = { 1: 'Empenho', 2: 'Liquidação', 3: 'Pagamento' };
const pageSize = 25;
let procurementData=null;
let noticesData=null;
let atasData=null;
const noticesState={query:'',modality:'all',attribution:'likely',srp:'all',minCents:null,maxCents:null,page:0};
const contractsState={query:'',source:'all',scope:'all',attribution:'likely',minCents:null,maxCents:null,activeOn:'',page:0};
const contractsPerPage=20;
const cache = new Map();
let commitmentTrajectories=[];
let trajectoryReady=false;
const state = { manifest: null, month: null, data: null, search: '', phase: 'all', day: 'all', page: 0 };

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
}
function appendDetailField(host,label,value,{long=false}={}){
  const group=element('div',long?'narrative-field':'');
  group.append(element('dt','',label),element('dd','',value??'Não informado'));
  host.append(group);
}
function showCatalogDetail(record,kind){
  const isNotice=kind==='notice';
  const dialog=$('record-dialog'),fields=$('record-fields');
  $('record-title').textContent=isNotice?
    (MODALITIES[record.modality]||'Licitação')+' · '+(record.number||record.pncpId):
    'Contrato formal · '+(record.number||record.id);
  $('record-eyebrow').textContent=isNotice?'PUBLICAÇÃO PNCP':'INSTRUMENTO CONTRATUAL';
  fields.replaceChildren();
  const data=isNotice?[
    ['Identificador PNCP',record.pncpId],
    ['Modalidade',MODALITIES[record.modality]||'Outra'],
    ['Número',record.number],
    ['Processo administrativo',record.process],
    ['Publicação',record.published?localDate(record.published):'Não informada'],
    ['Registro de preços',record.srp===true?'Sim':record.srp===false?'Não':'Não informado'],
    ['Unidade publicadora',record.publicationUasg||'158125 · IFC Reitoria'],
    ['Estimativa da contratação',fmtMoney(record.estimatedCents)],
    ['Valor homologado',fmtMoney(record.homologatedCents)],
    ['Evidência de Araquari',campusEvidenceLabel(noticeEvidence(record))]
  ]:[
    ['Identificador',record.pncpId||record.id],
    ['Número do instrumento',record.number],
    ['Espécie',record.kind||'Contrato formal'],
    ['Origem',contractSourceName(record.source)],
    ['Processo administrativo',record.process],
    ['Fornecedor',contractSupplier(record)],
    ['Data de assinatura',record.signed?localDate(record.signed):'Não informada'],
    ['Início da vigência',record.starts?localDate(record.starts):'Não informado'],
    ['Fim da vigência',record.ends?localDate(record.ends):'Não informado'],
    ['Valor contratual',fmtMoney(record.amountCents)],
    ['Evidência de Araquari',campusEvidenceLabel(campusEvidence(record))]
  ];
  if(record.recheckedAt)data.push(['Última reconsulta ao PNCP',localDate(record.recheckedAt)]);
  if(record.sourceUpdatedAt)data.push(['Atualização informada pelo PNCP',
    localDate(record.sourceUpdatedAt)]);
  if(record.lastChangedAt)data.push(['Alteração observada no acervo',
    localDate(record.lastChangedAt)]);
  if(record.revisionCount)data.push(['Revisões materiais observadas',
    String(record.revisionCount)]);
  for(const [label,value] of data)appendDetailField(fields,label,value);
  appendDetailField(fields,isNotice?'Objeto da licitação':'Objeto do contrato',
    record.object||'Descrição não disponível na fonte consultada',{long:true});
  const url=isNotice?publicNoticeUrl(record):publicPncpUrl(record);
  const link=$('record-official-link');
  link.hidden=!url;
  if(url)link.href=url;
  else link.removeAttribute('href');
  showDialogFromTop(dialog);
}
function status(message, kind = '') {
  $('status').className = 'notice' + (kind ? ' ' + kind : '');
  $('status').textContent = message;
}
function localDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
}
function monthName(month) {
  const date = new Date(month + '-15T12:00:00Z');
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
function summarize(phase) {
  const coverage = state.data.coverage.filter(entry => entry.phase === phase);
  const documents = state.data.documents.filter(doc => doc.phase === phase);
  const complete = coverage.length > 0 && coverage.every(entry => entry.complete);
  const invalid = coverage.reduce((n, x) => n + x.invalid, 0);
  const count = coverage.reduce((n, x) => n + x.count, 0);
  const overlap=(state.data.phaseObservations||[]).some(obs=>obs.phase===phase);
  const sum = complete && !invalid && !overlap &&
    documents.every(doc => Number.isSafeInteger(doc.cents))
    ? documents.reduce((n, doc) => n + doc.cents, 0) : null;
  return { count, sum, complete, invalid, overlap };
}
function renderStats() {
  const stats = [1, 2, 3].map(summarize);
  stats.forEach((stat, index) => {
    const phase = index + 1;
    $('amount-' + phase).textContent = fmtMoney(stat.sum);
    const prefix = stat.complete ? '' : 'Pelo menos ';
    $('count-' + phase).textContent = prefix + fmtCount(stat.count) +
      ' ocorrência(s) documentais nas datas consultadas' +
      (stat.invalid ? ' · ' + stat.invalid + ' valor(es) indisponível(is)' : '')+
      (stat.overlap ? ' · sobreposição entre fases (total monetário suspenso)' : '');
  });
  const valid = stats.filter(s => Number.isSafeInteger(s.sum));
  const max = Math.max(1, ...valid.map(s => Math.abs(s.sum)));
  const chart = $('phase-chart');
  chart.replaceChildren();
  stats.forEach((stat, i) => {
    const row = element('div', 'phase-row');
    const name = element('span', 'phase-name', phaseNames[i + 1]);
    const track = element('div', 'phase-track');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', phaseNames[i + 1] + ': ' + fmtMoney(stat.sum));
    const fill = element('div', 'phase-fill');
    fill.style.width = Number.isSafeInteger(stat.sum)
      ? Math.max(0, Math.min(100, Math.abs(stat.sum) / max * 100)) + '%' : '0%';
    track.append(fill);
    row.append(name, track, element('span', 'phase-total', fmtMoney(stat.sum)));
    chart.append(row);
  });
}
function renderQuality() {
  const audit=auditMonth(state.data),coverage=audit.coverage;
  $('days-covered').textContent=fmtCount(coverage.completeDays)+'/'+fmtCount(coverage.expectedDays);
  $('incomplete-count').textContent=fmtCount(coverage.partialQueries);
  $('invalid-count').textContent=fmtCount(coverage.invalidValues);
  $('relations-count').textContent=fmtCount(audit.links.total);
  $('liquidation-links').textContent=fmtCount(audit.enrichment.liquidations.checked)+'/'+
    fmtCount(audit.enrichment.liquidations.total);
  $('payment-links').textContent=fmtCount(audit.enrichment.payments.checked)+'/'+
    fmtCount(audit.enrichment.payments.total);
  $('item-links').textContent=fmtCount(audit.enrichment.items.checked)+'/'+
    fmtCount(audit.enrichment.items.total);
  $('multiple-ne-links').textContent=fmtCount(audit.links.multipleCommitments);
  $('quality-detail').textContent='Consultas complementares pendentes: '+
    fmtCount(audit.enrichment.pending)+'. Impactos negativos (incluindo anulações): '+
    fmtCount(audit.links.negative)+'. Relações com NEs de outros exercícios: '+
    fmtCount(audit.links.crossExercise)+'. Liquidações com valores vinculados diferentes '+
    'do valor documental, para revisão: '+fmtCount(audit.links.liquidationValueReviews)+
    '. Documentos em mais de um filtro da CGU: '+
    fmtCount(audit.phaseObservations?.total||0)+
    ' (valores divergentes: '+fmtCount(audit.phaseObservations?.amountDisagreements||0)+
    '). Aparições em fases distintas não comprovam operações financeiras adicionais. Esses casos não significam automaticamente erro contábil.';
  const hasGaps=coverage.status!=='completa',structural=audit.issues.length>0;
  $('coverage-chip').textContent=structural?'Dados exigem revisão':
    coverage.status==='completa'?'Dias encerrados consultados':
    coverage.status==='sem_dias_encerrados'?'Sem dias encerrados':'Cobertura diária parcial';
  status(structural
    ?'A auditoria identificou registros que exigem revisão estrutural, sem modificar os dados originais.'
    :hasGaps
      ?'Cobertura parcial: '+coverage.completeDays+' de '+coverage.expectedDays+
        ' dias encerrados com três fases válidas. '+coverage.missingDays+
        ' dia(s) sem consulta e '+coverage.partialDays+' parcialmente consultado(s). '+
        'Enriquecimento documental informado separadamente.'
      :'Todos os dias encerrados possuem três fases válidas. '+
        'O enriquecimento dos vínculos é medido à parte; não se trata de conciliação contábil.',
    structural||hasGaps?'warning':'success');
}
function formatCnpj(value) {
  return /^\d{14}$/.test(value || '') ? value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : value;
}
function beneficiaryLabel(doc, monthData = state.data) {
  if (doc.cpfMasked) return 'Pessoa física · CPF ' + doc.cpfMasked;
  if (!doc.partyRef) return 'Não identificado';
  const name = monthData.beneficiaries?.[doc.partyRef] || 'Pessoa jurídica';
  return name + ' · CNPJ ' + formatCnpj(doc.partyRef);
}
function filteredDocuments() {
  return state.data.documents.filter(doc => {
    if (state.phase !== 'all' && String(doc.phase) !== state.phase &&
      !(state.data.phaseObservations||[]).some(item=>
        item.id===doc.id&&String(item.phase)===state.phase)) return false;
    if (state.day !== 'all' && doc.date !== state.day) return false;
    const fields = [doc.id, doc.process, doc.cpfMasked, doc.partyRef,
      doc.partyRef && state.data.beneficiaries?.[doc.partyRef], ...Object.values(doc.nature || {})];
    if (state.search && !fields.filter(Boolean).join(' ').toLowerCase().includes(state.search)) return false;
    return true;
  });
}
function renderTable() {
  const all = filteredDocuments();
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  state.page = Math.min(Math.max(0, state.page), totalPages - 1);
  const shown = all.slice(state.page * pageSize, (state.page + 1) * pageSize);
  $('table-count').textContent = fmtCount(all.length) + ' resultado(s)';
  $('page-information').textContent = 'Página ' + (state.page + 1) + ' de ' + totalPages;
  $('previous-page').disabled = state.page === 0;
  $('next-page').disabled = state.page >= totalPages - 1;
  const body = $('doc-rows');
  body.replaceChildren();
  if (!shown.length) {
    const row = element('tr');
    const td = element('td', '', 'Nenhum documento para os filtros selecionados.');
    td.colSpan = 7;
    row.append(td); body.append(row);
    return;
  }
  shown.forEach(doc => {
    const row = element('tr');
    const id = element('td', 'doc-code', doc.id);
    const date = element('td', '', localDate(doc.date));
    const phase = element('td');
    phase.append(element('span', 'phase-label', phaseNames[doc.phase] || 'Outro'));
    const others=(state.data.phaseObservations||[]).filter(item=>item.id===doc.id);
    if(others.length)phase.append(element('span','small-muted',
      ' · também consta em '+others.map(item=>phaseNames[item.phase]).join(', ')));
    const beneficiary = element('td', 'beneficiary-cell', beneficiaryLabel(doc));
    const process = element('td', 'doc-code', doc.process || '—');
    const amount = element('td', 'align-right', fmtMoney(doc.cents));
    const details = element('td');
    const button = element('button', 'details-button', 'Ver detalhes');
    button.type = 'button';
    button.setAttribute('aria-label', 'Ver detalhes do documento ' + doc.id);
    button.addEventListener('click', () => showDocument(doc));
    details.append(button);
    row.append(id, date, phase, beneficiary, process, amount, details);
    row.addEventListener('click', event => {
      if (event.target !== button) showDocument(doc);
    });
    body.append(row);
  });
}
async function locateLinkedDocument(id) {
  const cached = [...cache.values()];
  for(const data of cached) {
    const doc=data.documents.find(entry=>entry.id===id);
    if(doc) return {doc,data};
  }
  for(const month of [...state.manifest.months].sort().reverse()){
    if(cache.has(month))continue;
    const response=await fetch('./data/months/'+month+'.json',{cache:'no-store'});
    if(!response.ok)continue;
    const data=await response.json();
    if(data?.schema_version!==1||data.unit!=='158459'||data.month!==month||
      !Array.isArray(data.documents)||!Array.isArray(data.relations))continue;
    cache.set(month,data);
    const doc=data.documents.find(entry=>entry.id===id);
    if(doc)return {doc,data};
  }
  return null;
}
function contractSourceName(source){
  return source==='pncp'?'PNCP':'Compras.gov.br';
}
function contractScopeName(scope){
  return scope==='campus'?'Cadastro CNPJ campus':'Reitoria/IFC (publicação centralizada)';
}
function publicPncpUrl(contract){
  if(contract.source!=='pncp')return null;
  const match=/^(\d{14})-[1-9]-(\d{6})\/(20\d{2})$/.exec(contract.pncpId||'');
  return match?'https://pncp.gov.br/app/contratos/'+match[1]+'/'+match[3]+'/'+Number(match[2]):null;
}
function contractSupplier(contract){
  if(contract.supplierCpfMasked)return 'Pessoa física · CPF '+contract.supplierCpfMasked;
  if(contract.supplierCnpj){
    return (contract.supplierName||'Pessoa jurídica')+' · CNPJ '+formatCnpj(contract.supplierCnpj);
  }
  return 'Não informado';
}
let historicalNeLoading=false;
async function loadHistoricalNeEvidence(){
 if(historicalNeLoading||!state.manifest)return;
 const months=state.manifest.months.filter(m=>!cache.has(m));
 const button=$('historical-ne-load'),indicator=$('historical-ne-status');
 historicalNeLoading=true;button.disabled=true;
 let completed=0,failed=0;
 try{
  for(const month of months){
   indicator.textContent='Conferindo competências históricas: '+(completed+failed)+' de '+months.length+' pendentes…';
   try{
    const response=await fetch('./data/months/'+month+'.json',{cache:'no-store'});
    if(!response.ok)throw Error('Arquivo mensal indisponível');
    const data=await response.json();
    if(data.schema_version!==1||data.unit!=='158459'||data.month!==month||
       !Array.isArray(data.documents)||!Array.isArray(data.relations)||
       !Array.isArray(data.coverage))throw Error('Dados mensais incompatíveis');
    cache.set(month,data);completed++;
   }catch{failed++}
  }
  indicator.textContent='Conferência histórica: '+fmtCount(cache.size)+' de '+
   fmtCount(state.manifest.months.length)+' competências carregadas'+
   (failed?' · '+fmtCount(failed)+' indisponível(is), tente novamente':'')+
   '. Ausência de NE não comprova inexistência de despesa.';
  if(noticesData)renderNotices();
  if(procurementData)renderContracts();
 }finally{historicalNeLoading=false;button.disabled=false;}
}
function loadedCguDocuments() {
  return [...cache.values()].flatMap(month=>month.documents);
}
function campusEvidence(contract) {
  return assessContractAttribution(contract,loadedCguDocuments());
}
function campusEvidenceLabel(evidence) {
  switch(evidence.level) {
    case 'confirmed':return 'NE oficial confirmada';
    case 'ne_indication':return 'Indício por UG / NE';
    case 'context':return 'Processo e fornecedor coincidentes';
    case 'process_indication':return 'Indício pelo processo 23349';
    default:return 'Sem atribuição de campus';
  }
}
function contractBadge(contract){
  return contractSourceName(contract.source)+' · '+contractScopeName(contract.scope);
}
function showContractAssociations(doc){
  const slot=$('dialog-contracts');
  slot.replaceChildren();
  if(!procurementData){
    slot.append(element('p','small-muted','Catálogo de contratos ainda não disponível.'));
    return;
  }
  const matches=procurementData.contracts.filter(isFormalContract).map(contract=>
    ({contract,evidence:matchDocumentContract(doc,contract)}))
    .filter(item=>item.evidence)
    .sort((a,b)=>(a.evidence.level==='confirmed'?0:1)-
      (b.evidence.level==='confirmed'?0:1));
  if(!matches.length){
    slot.append(element('p','small-muted',
      'Nenhuma correspondência comprovada ou contextual encontrada no catálogo consultado.'));
    return;
  }
  for(const {contract,evidence} of matches.slice(0,8)){
    const block=element('div','relation-item');
    block.append(element('strong','',
      (evidence.level==='confirmed'?'NE da UG 158459 confirmada':
       evidence.level==='context'?'Correspondência processo + CNPJ':
       'Correspondência processual não confirmada')+
      ' · '+(contract.number||contract.id)));
    block.append(element('span','small-muted',contractBadge(contract)));
    block.append(element('span','small-muted',evidence.reason));
    if(contract.object)block.append(element('span','small-muted',contract.object));
    if(contract.procurementId){
      const official=publicNoticeUrl({pncpId:contract.procurementId});
      if(official){
        const anchor=element('a','inline-link','Licitação de origem no PNCP');
        anchor.href=official;anchor.target='_blank';anchor.rel='noopener noreferrer';
        block.append(anchor);
      }
    }
    const url=publicPncpUrl(contract);
    if(url){
      const link=element('a','inline-link','Ver registro oficial no PNCP');
      link.href=url;link.target='_blank';link.rel='noopener noreferrer';
      block.append(link);
    }
    slot.append(block);
  }
  if(matches.length>8)slot.append(element('p','small-muted',
    'Outras '+(matches.length-8)+' correspondência(s) disponíveis no explorador.'));
}
function explainSiafiReconciliation(items,doc){
 const a=reconcileSiafiCommitment(items,{listingDate:doc?.date,
   documentCents:doc?.cents,commitmentYear:doc?.id?.slice(11,15)});
 if(a.status==='partial')return 'Reconstrução ainda pendente: apenas '+
   a.checked+'/'+a.total+' itens com histórico completo. Nenhum saldo inferido.';
 if(a.status==='unavailable')return 'Reconstrução não disponível ('+({
   items_not_collected:'itens ainda não coletados',
   empty_item_catalog:'nenhum item retornado',
   no_movement_evidence:'movimentações não retornadas',
   ambiguous_movement:'tipo, sinal ou data não suficientemente identificado',
   multiple_originals:'mais de uma inclusão original para o mesmo item',
   original_missing:'sem inclusão original',
   movement_before_original:'movimento anterior à inclusão original',
   arithmetic_or_sequence_invalid:'sequência ou valor aritmético incoerente',
   aggregate_overflow:'total fora do limite numérico seguro',
   item_amount_invalid:'valor atual do item indisponível',
   cancellation_year_unverified:'cancelamento de restos a pagar sem ano posterior validado',
   original_year_mismatch:'inclusão original fora do exercício do empenho'
 }[a.reason]||'dados insuficientes')+'). Não foi calculado saldo.';
 const listing=a.originalDateMatchesListing===false?
   ' A data da primeira inclusão identificada no histórico ('+localDate(a.originalDate)+
   ') difere da data informada na listagem ('+localDate(doc?.date)+').':
   ' Primeira inclusão identificada: '+localDate(a.originalDate)+'.';
 return 'Base da inclusão: '+fmtMoney(a.initialCents)+
   ' · Reforços: '+fmtMoney(a.reinforcementCents)+
   ' · Anulações: '+fmtMoney(a.annulmentCents)+
   (a.cancellationCents?' · Cancelamentos posteriores: '+fmtMoney(a.cancellationCents):'')+
   ' · Valor reconstruído por operações: '+fmtMoney(a.reconstructedCents)+
   ' · Valor atual dos itens informado pela CGU: '+fmtMoney(a.reportedCents)+
   '. '+(a.status==='reconciled'?
     'Conferência aritmética coincidente.':'Divergência aritmética: revisão necessária.')+
   listing+' Trata-se do valor atual reconstruído dos itens, não do saldo a liquidar, saldo a pagar ou restos a pagar.';
}
function explainSiafiMovementAudit(items,doc){
 const a=auditSiafiItemMovements(items,{issueDate:doc?.date,
   documentCents:doc?.cents});
 if(a.status==='unavailable')return 'Itens ainda não consultados; sem condições de conferir os movimentos.';
 const coverage='Históricos de itens consultados: '+a.checked+'/'+a.totalItems+'. ';
 const amount=a.documentAmountMatch===true?
   'A soma dos valores atuais dos itens coincide com o valor documental da NE. ':
   a.documentAmountMatch===false?
   'A soma dos itens difere do valor documental da NE e exige revisão. ':
   'Comparação dos valores totais indisponível. ';
 if(a.status==='partial')return coverage+amount+
   'Há itens pendentes; não é possível afirmar ausência de reforço ou anulação.';
 if(a.status==='no_items')return coverage+'Não há itens coletados para esta NE.';
 if(a.status==='no_movement_evidence')return coverage+amount+
   'A CGU não retornou operações para pelo menos um item; ausência de movimento não comprovada.';
 if(a.status==='original_only_consistent')return coverage+amount+
   'Todos os itens consultados apresentam somente uma inclusão na data de emissão, com valores coincidentes. Isso é conferência documental, não conciliação de saldo contábil.';
 return coverage+amount+
   'Movimentações classificadas: inclusões '+a.counts.original+
   ', reforços '+a.counts.reinforcement+', anulações '+a.counts.annulment+
   ', outras '+(a.counts.cancellation+a.counts.reversal+a.counts.other+a.counts.unknown)+
   '. Conferência do efeito financeiro e dos sinais ainda necessária; não foi calculado saldo.';
}
function summarizeItemOperations(items,issueDate){
 if(!Array.isArray(items))return 'Histórico ainda não consultado.';
 const checked=items.filter(item=>item.historyChecked===true).length;
 if(!checked)return 'Movimentações dos itens ainda não consultadas.';
 const others=items.flatMap(item=>(item.movements||[])
   .filter(event=>event.date!==issueDate&&event.type!=='original')
   .map(event=>({seq:item.seq,date:event.date,operation:event.operation})))
   .sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq);
 const coverage='Itens com histórico completo: '+checked+'/'+items.length+'. ';
 if(!others.length)return coverage+
   'Nenhuma operação posterior identificada nesses históricos, sem garantia de ausência de alterações em itens pendentes.';
 return coverage+'Operações posteriores identificadas: '+
   others.slice(0,12).map(x=>'seq. '+String(x.seq).padStart(3,'0')+
     ' · '+localDate(x.date)+' · '+x.operation).join('; ')+
   (others.length>12?' e mais '+(others.length-12)+' operação(ões) nos itens.':'')+
   '. A data de emissão do empenho permanece independente dessas operações.';
}
function renderSiafiItems(target,items){
 target.replaceChildren();
 const groups=new Map();
 for(const item of items||[]){
   const key=(item.sub||'sem-codigo')+'|'+(item.subdesc||'');
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(item);
 }
 for(const [key,group] of groups){
   const [code,description]=key.split('|');
   const section=element('section','item-subgroup');
   const heading=element('h3','item-subgroup-heading',
     'Subelemento '+(code==='sem-codigo'?'não informado':code)+
     (description?' — '+description:''));
   section.append(heading);
   for(const item of group){
     const block=element('div','relation-item item-detail-card');
     const title='Seq. '+String(item.seq).padStart(3,'0')+
       (item.purchaseItem?' · Compra '+item.purchaseItem:'');
     block.append(element('strong','',title));
     block.append(element('p','item-full-description',
       item.description||'Descrição específica não disponibilizada pela fonte'));
     block.append(element('span','small-muted','Valor atual informado do item: '+
       (Number.isSafeInteger(item.cents)?fmtMoney(item.cents):'Indisponível')));
     if(item.historyChecked===true){
       const movements=item.movements||[];
       const info=element('details','item-history');
       const caption=element('summary','',
         'Movimentações do item ('+movements.length+')');
       info.append(caption);
       if(!movements.length)info.append(element('p','small-muted',
         'Consulta concluída, sem movimentações disponíveis na API CGU.'));
       for(const event of movements){
         const movement=element('div','item-history-row');
         movement.append(element('strong','',
           localDate(event.date)+' · '+event.operation));
         movement.append(element('span','small-muted',
           'Quantidade: '+event.quantity.replace('.',',')+
           ' · Valor unitário: R$ '+event.unitPrice.replace('.',',')+
           ' · Valor da operação: '+fmtMoney(event.cents)));
         info.append(movement);
       }
       block.append(info);
     }else block.append(element('span','small-muted',
       'Histórico de quantidade, preço unitário e alterações aguardando consulta.'));
     section.append(block);
   }
   const known=group.every(item=>Number.isSafeInteger(item.cents));
   if(known)section.append(element('p','small-muted',
     'Soma dos valores atuais dos itens deste subelemento disponíveis no acervo: '+
     fmtMoney(group.reduce((total,item)=>total+item.cents,0))+
     '. Não corresponde necessariamente ao saldo histórico.'));
   target.append(section);
 }
}
function showDocument(doc, monthData = state.data) {
  $('dialog-trajectory-section').hidden=true;
  $('dialog-relations-title').hidden=false;
  $('dialog-title').textContent = doc.id;
  const fields = $('dialog-fields');
  fields.replaceChildren();
  const entries = [
    ['Documento SIAFI', doc.id],
    ['Espécie do documento', documentSpecies(doc).label],
    ['Fase de divulgação original', financialPhaseDescription(doc.phase)],
    ['Outros filtros da CGU em que aparece',
      (monthData.phaseObservations||[]).filter(o=>o.id===doc.id)
        .map(o=>phaseNames[o.phase]+(o.amountRelation==='different'?
          ' (valor informado divergente)':o.amountRelation==='unknown'?
          ' (comparação de valores indisponível)':' (mesmo valor informado)'))
        .join('; ')||'Nenhum outro filtro identificado'],
    ['Data informada na listagem CGU', localDate(doc.date)], [doc.valueSource==='impactos_cgu'?'Valor recuperado dos impactos CGU':'Valor documental', fmtMoney(doc.cents)],
    ['Unidade gestora', '158459 · IFC Araquari'],
    ['Favorecido', beneficiaryLabel(doc,monthData)],
    ['Processo administrativo', doc.process || 'Não informado'],
    ['Grupo de despesa', doc.nature?.group || 'Não informado'],
    ['Elemento', doc.nature?.element || 'Não informado'],
    ['Programa', doc.nature?.program || 'Não informado'],
    ['Ação orçamentária', doc.nature?.action || 'Não informada'],
    ['Consulta de vínculos',doc.phase===3
      ?(doc.paymentLinksChecked?'Concluída nesta base':'Aguardando enriquecimento')
      :doc.phase===2?(doc.liquidationLinksChecked?'Concluída nesta base':
        'Aguardando consulta dos empenhos impactados'):'Conforme documentos disponíveis'],
    ['Fonte', 'CGU / Portal da Transparência']
  ];
  for(const [label,value] of entries)appendDetailField(fields,label,value);
  appendDetailField(fields,'Descrição / observação do documento SIAFI',
    doc.description||'Texto não disponibilizado ou não publicável na fonte consultada',
    {long:true});
  const relationsMap=new Map();
  for(const loaded of cache.values()) {
    for(const relation of loaded.relations) {
      if(relation.from!==doc.id && relation.to!==doc.id)continue;
      relationsMap.set(relation.from+'/'+relation.to,relation);
    }
  }
  const list=$('dialog-relations');
  list.replaceChildren();
  if(!relationsMap.size) {
    list.append(element('p','small-muted',doc.phase===3 && !doc.paymentLinksChecked
      ?'Vínculos deste pagamento ainda não consultados pelo coletor incremental.'
      :'Nenhum vínculo identificado nos meses já carregados.'));
  } else {
    for(const relation of relationsMap.values()) {
      const item=element('div','relation-item');
      const from=relation.from===doc.id;
      const associated=from?relation.to:relation.from;
      const isPayment=/20\d{2}(?:OB|DF|DR|GP)\d{6}$/.test(relation.from);
      const label=from?'Empenho impactado':
        (isPayment?'Pagamento relacionado':'Liquidação relacionada');
      item.append(element('span','small-muted',label));
      const button=element('button','relation-link doc-code',associated);
      button.type='button';
      button.title='Consultar ficha do documento relacionado';
      button.addEventListener('click',async()=>{
        button.disabled=true;
        button.textContent='Localizando documento…';
        try{
          const found=await locateLinkedDocument(associated);
          if(found)showDocument(found.doc,found.data);
          else button.textContent='Documento ainda não coletado';
        }catch{
          button.textContent='Consulta do acervo indisponível';
        }finally{
          button.disabled=false;
        }
      });
      item.append(button,element('strong','', 'Valor vinculado: '+fmtMoney(relation.cents)));
      list.append(item);
    }
  }
  if(doc.phase===1)appendDetailField(fields,'Alterações observadas no histórico dos itens',
    summarizeItemOperations(monthData.itemsByDocument?.[doc.id],doc.date),{long:true});
  if(doc.phase===1)appendDetailField(fields,'Conferência documental do empenho',
    explainSiafiMovementAudit(monthData.itemsByDocument?.[doc.id],doc),{long:true});
  if(doc.phase===1)appendDetailField(fields,'Reconstrução aritmética das movimentações',
    explainSiafiReconciliation(monthData.itemsByDocument?.[doc.id],doc),{long:true});
  const itemSection=$('dialog-items-section');
  itemSection.hidden=doc.phase!==1;
  const details=$('dialog-items');
  details.replaceChildren();
  if(doc.phase===1) {
    const items=monthData.itemsByDocument?.[doc.id];
    if(!Array.isArray(items)) {
      details.append(element('p','small-muted','Itens aguardando consulta incremental da CGU.'));
    } else if(!items.length) {
      details.append(element('p','small-muted','Consulta concluída: nenhum item disponível para esta NE.'));
    } else {
      renderSiafiItems(details,items);
    }
  }
  showContractAssociations(doc);
  showDialogFromTop($('document-dialog'));
}
function refreshFilters() {
  state.page = 0;
  renderTable();
}
function renderDays() {
  const days = [...new Set(state.data.coverage.map(item => item.date))].sort().reverse();
  const selector = $('day-filter');
  selector.replaceChildren(element('option', '', 'Todos os dias'));
  selector.firstChild.value = 'all';
  days.forEach(day => {
    const option = element('option', '', localDate(day));
    option.value = day;
    selector.append(option);
  });
  selector.value = 'all'; state.day = 'all';
}
function renderAll() {
  renderDays(); renderStats(); renderQuality(); renderTable();
  $('updated').textContent = state.data.updated_at
    ? 'Arquivo atualizado em ' + new Date(state.data.updated_at).toLocaleString('pt-BR')
    : 'Sem registro de atualização';
}

async function loadAllTrajectoryMonths(){
  if(trajectoryReady)return;
  status('Carregando competências para reconstruir as trajetórias…');
  const months=[...state.manifest.months].sort();
  const loaded=[];
  for(const month of months){
    if(!cache.has(month)){
      const response=await fetch('./data/months/'+month+'.json',{cache:'no-store'});
      if(!response.ok)throw Error('Não foi possível carregar '+month);
      const data=await response.json();
      if(data?.schema_version!==1||data.unit!=='158459'||data.month!==month||
        !Array.isArray(data.documents)||!Array.isArray(data.relations))
        throw Error('Dados incompatíveis em '+month);
      cache.set(month,data);
    }
    loaded.push(cache.get(month));
  }
  commitmentTrajectories=buildCommitmentTrajectories(loaded);
  const audit=auditCommitmentTrajectories(loaded);
  trajectoryReady=true;
  renderCommitmentTrajectories();
  $('trajectory-status').textContent=months.length+' competência(s) analisadas · '+
    fmtCount(audit.commitmentDocuments)+' NEs coletadas · '+
    fmtCount(audit.commitmentsWithoutDocument)+' NEs referenciadas sem documento · '+
    fmtCount(audit.missingRelationSources)+' origens não localizadas · '+
    fmtCount(audit.conflictingRelations+audit.conflictingDocuments)+' divergências de duplicidade. '+
    'Relações documentais não equivalem a conciliação contábil.';
}
function renderCommitmentTrajectories(){
  const query=$('trajectory-search').value;
  const all=filterCommitmentTrajectories(commitmentTrajectories,query);
  const tbody=$('trajectory-rows');tbody.replaceChildren();
  $('trajectory-count').textContent=fmtCount(all.length)+' empenho(s) com registro ou vínculo';
  if(!all.length){
    const row=element('tr'),cell=element('td','','Nenhum empenho corresponde à pesquisa.');
    cell.colSpan=7;row.append(cell);tbody.append(row);return;
  }
  for(const entry of all){
    const row=element('tr');
    const ne=element('td','doc-code',entry.id);
    const date=element('td','',entry.document?.date?localDate(entry.document.date):'NE não coletada');
    const process=element('td','doc-code',entry.document?.process||'—');
    const object=element('td','beneficiary-cell',entry.document?.nature?.element||'Não informado');
    const lq=element('td','align-right',fmtMoney(entry.liquidationCents));
    const pg=element('td','align-right',fmtMoney(entry.paymentCents));
    const action=element('td','');
    const button=element('button','details-button','Abrir trajetória');
    button.type='button';button.addEventListener('click',()=>showCommitmentTrajectory(entry));
    action.append(button);row.append(ne,date,process,object,lq,pg,action);tbody.append(row);
  }
}
function renderTrajectoryLinks(target,links,emptyText){
  target.replaceChildren();
  if(!links.length){target.append(element('p','small-muted',emptyText));return;}
  for(const link of links){
    const item=element('div','relation-item');
    const caption=(link.document?.id||link.id)+' · '+(link.date?localDate(link.date):'Data indisponível');
    item.append(element('strong','',caption));
    item.append(element('span','small-muted','Valor vinculado: '+fmtMoney(link.cents)));
    item.append(element('span','small-muted',link.checked===true?'Consulta de vínculos concluída':
      link.checked===false?'Consulta de vínculos pendente':'Documento relacionado não localizado no acervo carregado'));
    if(link.document){
      const open=element('button','relation-link doc-code','Abrir documento');
      open.type='button';open.addEventListener('click',()=>showDocument(link.document,cache.get(link.month)||state.data));
      item.append(open);
    }
    target.append(item);
  }
}
function showCommitmentTrajectory(entry){
  $('dialog-trajectory-section').hidden=false;
  $('dialog-relations-title').hidden=true;
  $('dialog-title').textContent='Trajetória da NE · '+entry.id;
  const fields=$('dialog-fields');fields.replaceChildren();
  const doc=entry.document;
  const entries=[
    ['Documento de empenho',entry.id],
    ['Data informada na listagem CGU',doc?.date?localDate(doc.date):'Não coletada na base mensal'],
    ['Processo',doc?.process||'Não informado'],
    ['Valor documental da NE',doc?fmtMoney(doc.cents):'Indisponível: NE não coletada'],
    ['Cobertura documental',!doc?'NE referenciada, mas não coletada':
      entry.hasUnresolvedSources?'NE coletada; há documentos relacionados ausentes':
      'Documentos relacionados disponíveis no acervo (sem garantia de completude)'],
    ['UG','158459 · IFC Araquari'],
    ['Natureza da despesa',doc?.nature?.element||'Não informada'],
    ['Exercício da NE',entry.id.slice(11,15)],
    ['Itens do empenho',entry.itemsChecked?'Consulta concluída':'Aguardando consulta']
  ];
  for(const [label,value] of entries)appendDetailField(fields,label,value);
  appendDetailField(fields,'Descrição / observação da nota de empenho',
    doc?.description||'Texto não disponibilizado ou não publicável na fonte consultada',
    {long:true});
  appendDetailField(fields,'Alterações observadas no histórico dos itens',
    summarizeItemOperations(entry.items,doc?.date),{long:true});
  appendDetailField(fields,'Conferência documental do empenho',
    explainSiafiMovementAudit(entry.items,doc),{long:true});
  appendDetailField(fields,'Reconstrução aritmética das movimentações',
    explainSiafiReconciliation(entry.items,doc),{long:true});
  $('dialog-relations').replaceChildren();
  $('dialog-items-section').hidden=!entry.itemsChecked;
  const items=$('dialog-items');items.replaceChildren();
  renderSiafiItems(items,entry.items||[]);
  renderTrajectoryLinks($('dialog-liquidations'),entry.liquidations,
    'Nenhuma liquidação vinculada identificada no acervo consultado.');
  renderTrajectoryLinks($('dialog-payments'),entry.payments,
    'Nenhum documento da fase de pagamento vinculado identificado no acervo consultado.');
  $('dialog-trajectory-note').textContent=
    'A ausência de vínculo no acervo não significa ausência de execução. Liquidações e pagamentos são apresentados em grupos independentes. A CGU vincula ambos às NEs; isso não comprova relação direta entre uma NS e uma OB/DF, nem quitação integral do empenho. Valores negativos são preservados como retornados pela fonte. Os totais abaixo são somas dos vínculos documentais disponíveis, não saldo contábil.';
  $('dialog-trajectory-summary').textContent=
    'Vínculos de liquidação: '+fmtCount(entry.liquidations.length)+' documento(s), '+fmtMoney(entry.liquidationCents)+
    '. Vínculos de pagamento: '+fmtCount(entry.payments.length)+' documento(s), '+fmtMoney(entry.paymentCents)+
    '. Pendências de consulta: '+(entry.pendingLiquidations||entry.pendingPayments?'sim':'não identificado nos documentos vinculados carregados')+'.';
  $('dialog-contracts').replaceChildren(element('p','small-muted',
    'A associação com contrato formal permanece na seção de contratações e depende de evidência oficial; empenho substitutivo não é classificado como contrato formal.'));
  showDialogFromTop($('document-dialog'));
}
async function initTrajectories(){
  $('trajectory-section').hidden=false;
  $('trajectory-search').addEventListener('input',renderCommitmentTrajectories);
  $('trajectory-reload').addEventListener('click',async()=>{
    $('trajectory-reload').disabled=true;
    try{trajectoryReady=false;await loadAllTrajectoryMonths();}
    catch{$('trajectory-status').textContent='Falha ao carregar uma ou mais competências. Os dados originais foram preservados.';}
    finally{$('trajectory-reload').disabled=false;}
  });
  $('trajectory-load').addEventListener('click',async()=>{
    $('trajectory-load').disabled=true;
    try{await loadAllTrajectoryMonths();}
    catch{$('trajectory-status').textContent='Não foi possível reconstruir as trajetórias. Verifique a disponibilidade dos JSONs mensais.';}
    finally{$('trajectory-load').disabled=false;}
  });
}

async function loadMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    !state.manifest.months.includes(month)) throw Error('Competência não disponível');
  status('Carregando documentos e vínculos da competência…');
  if (!cache.has(month)) {
    const url = './data/months/' + month + '.json';
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw Error('Arquivo mensal não disponível');
    const data = await response.json();
    if (data.schema_version !== 1 || data.unit !== '158459' || data.month !== month ||
      !Array.isArray(data.documents) || !Array.isArray(data.coverage) ||
      !Array.isArray(data.relations)) throw Error('Dados mensais incompatíveis');
    cache.set(month, data);
  }
  state.month = month;
  state.data = cache.get(month);
  state.page = 0; state.phase = 'all'; state.search = ''; state.day = 'all';
  $('phase-filter').value = 'all';
  $('search-doc').value = '';
  renderAll();
  if(procurementData)renderContracts();
  if(noticesData)renderNotices();
}
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function exportCsv() {
  const rows = filteredDocuments();
  const data = ['documento,data_emissao,fase,valor_centavos,favorecido,processo'];
  for (const row of rows) {
    data.push([row.id, row.date, phaseNames[row.phase],
      row.cents === null ? '' : row.cents,
      beneficiaryLabel(row), row.process || ''].map(csvCell).join(','));
  }
  const blob = new Blob(['\uFEFF' + data.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = 'observatorio-ug-158459-' + state.month + '.csv';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function initEvents() {
  $('month-select').addEventListener('change', async event => {
    try { await loadMonth(event.target.value); }
    catch { status('Não foi possível carregar esta competência. Dados anteriores preservados.', 'warning'); }
  });
  $('search-doc').addEventListener('input', event => {
    state.search = event.target.value.trim().toLowerCase(); refreshFilters();
  });
  $('phase-filter').addEventListener('change', event => {
    state.phase = event.target.value; refreshFilters();
  });
  $('day-filter').addEventListener('change', event => {
    state.day = event.target.value; refreshFilters();
  });
  $('clear-filters').addEventListener('click', () => {
    state.search = ''; state.phase = 'all'; state.day = 'all';
    $('search-doc').value = ''; $('phase-filter').value = 'all'; $('day-filter').value = 'all';
    refreshFilters();
  });
  for (const card of document.querySelectorAll('.stat-card')) {
    card.addEventListener('click', () => {
      state.phase = card.dataset.phase; $('phase-filter').value = state.phase;
      refreshFilters(); $('explorer-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  $('previous-page').addEventListener('click', () => { state.page--; renderTable(); });
  $('next-page').addEventListener('click', () => { state.page++; renderTable(); });
  $('export-button').addEventListener('click', exportCsv);
  $('close-dialog').addEventListener('click', () => $('document-dialog').close());
  $('close-record-dialog').addEventListener('click', () => $('record-dialog').close());
  const theme = localStorage.getItem('observatorio-tema');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('observatorio-tema', next);
  });
}
async function init() {
  initEvents();
  try {
    const response = await fetch('./data/manifest.json', { cache: 'no-store' });
    if (!response.ok) throw Error('Manifesto indisponível');
    const manifest = await response.json();
    if (manifest.schema_version !== 1 || manifest.unit !== '158459' ||
      !Array.isArray(manifest.months)) throw Error('Manifesto incompatível');
    state.manifest = manifest;
    if (!manifest.months.length) {
      $('empty-state').hidden = false;
      status('O projeto está publicado, mas a primeira coleta da CGU ainda não foi realizada.');
      return;
    }
    const selector = $('month-select');
    selector.replaceChildren();
    [...manifest.months].sort().reverse().forEach(month => {
      const option = element('option', '', monthName(month));
      option.value = month; selector.append(option);
    });
    $('dashboard').hidden = false;
    await loadMonth(selector.value);
  } catch {
    $('dashboard').hidden = true; $('empty-state').hidden = false;
    $('empty-title').textContent = 'Dados indisponíveis';
    $('empty-description').textContent =
      'Não foi possível carregar a base pública. Verifique a publicação do GitHub Pages e o status da coleta.';
    status('Falha ao carregar o acervo público. Nenhum total foi presumido.', 'warning');
  }
}

function filteredContracts(){
  if(!procurementData)return [];
  return procurementData.contracts.filter(contract=>{
    if(!isFormalContract(contract))return false;
    if(!filterStructuredContract(contract,contractsState))return false;
    if(contractsState.source!=='all'&&contract.source!==contractsState.source)return false;
    if(contractsState.scope!=='all'&&contract.scope!==contractsState.scope)return false;
    const evidence=campusEvidence(contract);
    if(contractsState.attribution==='confirmed'&&evidence.level!=='confirmed')return false;
    if(contractsState.attribution==='likely'&&evidence.level==='unverified')return false;
    if(contractsState.attribution==='unverified'&&evidence.level!=='unverified')return false;
    const fields=[contract.id,contract.number,contract.pncpId,contract.procurementId,
      contract.process,contract.supplierCnpj,contract.supplierCpfMasked,
      contract.supplierName,contract.object,contract.kind,contract.signed,
      contract.starts,contract.ends,contract.publishedMonth,contract.unitCode,
      contract.amountCents,contract.commitmentStatus,contract.procurementLinkStatus,
      ...(contract.commitmentRefs||[])];
    return !contractsState.query||fields.filter(Boolean).join(' ').toLowerCase()
      .includes(contractsState.query);
  });
}
function renderContracts(){
  const all=filteredContracts();
  const totalPages=Math.max(1,Math.ceil(all.length/contractsPerPage));
  contractsState.page=Math.min(Math.max(contractsState.page,0),totalPages-1);
  const rows=all.slice(contractsState.page*contractsPerPage,
    (contractsState.page+1)*contractsPerPage);
  const formal=procurementData.contracts.filter(isFormalContract).length;
  $('contract-count').textContent=fmtCount(all.length)+' de '+
    fmtCount(formal)+' contratos formais no acervo IFC';
  $('contract-pages').textContent='Página '+(contractsState.page+1)+' de '+totalPages;
  $('contract-prev').disabled=contractsState.page===0;
  $('contract-next').disabled=contractsState.page>=totalPages-1;
  const tbody=$('contract-rows');
  tbody.replaceChildren();
  if(!rows.length){
    const row=element('tr'),cell=element('td','',
      'Nenhum contrato disponível para os filtros e períodos já consultados.');
    cell.colSpan=8;row.append(cell);tbody.append(row);return;
  }
  for(const contract of rows){
    const row=element('tr');
    const source=element('td','',
      contractSourceName(contract.source)+' · '+contractScopeName(contract.scope));
    const evidence=campusEvidence(contract);
    const proof=element('td','',campusEvidenceLabel(evidence));
    proof.title=evidence.reason;
    const idcell=element('td','');
    const link=publicPncpUrl(contract);
    if(link){
      const a=element('a','doc-code',contract.number||contract.pncpId);
      a.href=link;a.target='_blank';a.rel='noopener noreferrer';
      idcell.append(a);
    }else{idcell.append(element('span','doc-code',contract.number||contract.id));}
    const supplier=element('td','beneficiary-cell',contractSupplier(contract));
    const process=element('td','doc-code',contract.process||'—');
    const details=element('td');
    const open=element('button','details-button','Ver detalhes');
    open.type='button';open.addEventListener('click',()=>showCatalogDetail(contract,'contract'));
    details.append(open);
    const amount=element('td','align-right',
      Number.isSafeInteger(contract.amountCents)?fmtMoney(contract.amountCents):'Não informado');
    const purchaseCell=element('td','');
    if(contract.procurementId){
      const notice=noticesData?.notices?.find(n=>n.pncpId===contract.procurementId);
      const page=publicNoticeUrl({pncpId:contract.procurementId});
      if(page){
        const link=element('a','inline-link',
          notice ? (MODALITIES[notice.modality]||'Licitação')+' · '+(notice.number||'PNCP'):
            'Contratação de origem · PNCP');
        link.href=page;link.target='_blank';link.rel='noopener noreferrer';
        link.title='Identificador oficial de contratação fornecido pelo detalhe deste contrato';
        purchaseCell.append(link);
      }
    } else {
      purchaseCell.append(element('span','small-muted',
        contract.procurementLinkStatus==='unavailable'?'Consulta indisponível':
        contract.procurementLinkStatus==='not_reported'?'Sem referência informada':
        'Aguardando consulta'));
    }
    row.append(source,proof,idcell,purchaseCell,supplier,process,amount,details);
    tbody.append(row);
  }
}
function renderContractCoverage(){
  const coverages=procurementData?.coverage||[];
  if(!coverages.length){
    $('contract-coverage').className='notice warning';
    $('contract-coverage').textContent='Nenhuma competência contratual consultada ainda.';
    return;
  }
  const labels=coverages.slice().sort((a,b)=>b.month.localeCompare(a.month)||
    a.source.localeCompare(b.source)).slice(0,8).map(c=>{
    const status=c.status==='complete'?'consulta completa':
      c.status==='partial'?'consulta com registros descartados':'API indisponível';
    return contractSourceName(c.source)+' '+c.month+': '+status;
  });
  const incomplete=coverages.some(c=>c.status!=='complete');
  $('contract-coverage').className='notice'+(incomplete?' warning':' success');
  const totals=summarizeInstrumentTypes(procurementData.contracts);
  $('contract-types-summary').textContent=fmtCount(totals.formal)+' contrato(s) formal(is) · '+
    fmtCount(totals.commitments)+' nota(s) de empenho substitutiva(s) separadas da tabela'+
    (totals.other||totals.unclassified?
      ' · '+fmtCount(totals.other+totals.unclassified)+' instrumento(s) não classificados como termo de contrato':'')+
    '. Total da coleção PNCP/Compras: '+fmtCount(procurementData.contracts.length)+
    ' instrumento(s). Sem somar valores entre cadastros.';
  $('contract-coverage').textContent=labels.join(' · ')+
    '. A seção abaixo mostra apenas contratos formais. Por padrão, destaca somente '+
    'os que possuem evidências de Araquari. Processos e publicações podem ser incompletos.';
}
async function initProcurement(){
  $('procurement-section').hidden=false;
  $('contract-search').addEventListener('input',value=>{
    contractsState.query=value.target.value.trim().toLowerCase();
    contractsState.page=0;renderContracts();
  });
  $('contract-source').addEventListener('change',value=>{
    contractsState.source=value.target.value;contractsState.page=0;renderContracts();
  });
  $('contract-scope').addEventListener('change',value=>{
    contractsState.scope=value.target.value;contractsState.page=0;renderContracts();
  });
  $('contract-attribution').addEventListener('change',value=>{
    contractsState.attribution=value.target.value;contractsState.page=0;renderContracts();
  });
  for(const [id,field] of [['contract-min-value','minCents'],['contract-max-value','maxCents']]){
    $(id).addEventListener('input',e=>{
      const raw=e.target.value.trim(),parsed=parseReaisFilter(raw);
      e.target.setCustomValidity(raw&&parsed===null?'Informe um valor em reais válido.':'');
      contractsState[field]=parsed;contractsState.page=0;renderContracts();
    });
  }
  $('contract-active-on').addEventListener('change',e=>{
    contractsState.activeOn=e.target.value;contractsState.page=0;renderContracts();
  });
  $('clear-contract-filters').addEventListener('click',()=>{
    contractsState.query='';contractsState.source='all';contractsState.scope='all';
    contractsState.attribution='likely';contractsState.minCents=null;
    contractsState.maxCents=null;contractsState.activeOn='';
    contractsState.page=0;
    for(const id of ['contract-min-value','contract-max-value','contract-active-on'])$(id).value='';
    $('contract-search').value='';
    $('contract-source').value='all';$('contract-scope').value='all';
    $('contract-attribution').value='likely';
    renderContracts();
  });
  $('contract-prev').addEventListener('click',()=>{
    contractsState.page--;renderContracts();
  });
  $('contract-next').addEventListener('click',()=>{
    contractsState.page++;renderContracts();
  });
  try{
    const response=await fetch('./data/procurement/contracts.json',{cache:'no-store'});
    if(!response.ok)throw Error('Catálogo ainda não publicado');
    const data=await response.json();
    if(data.schema_version!==1||data.unit!=='158459'||
       !Array.isArray(data.contracts)||!Array.isArray(data.coverage))
      throw Error('Formato de contratos incompatível');
    procurementData=data;
    renderContractCoverage();
    renderContracts();
  }catch{
    procurementData={contracts:[],coverage:[]};
    $('contract-types-summary').textContent='Aguardando classificação das espécies contratuais.';
    $('contract-coverage').textContent=
      'Aguardando primeira sincronização PNCP/Compras.gov; nenhuma contratação foi presumida.';
    $('contract-coverage').className='notice warning';
    renderContracts();
  }
}


function publicNoticeUrl(notice) {
  const id=/^(\d{14})-1-(\d{6})\/(20\d{2})$/.exec(notice?.pncpId||'');
  return id?'https://pncp.gov.br/app/editais/'+id[1]+'/'+id[3]+'/'+Number(id[2]):null;
}
function noticeEvidence(notice) {
  return assessNoticeAttribution(notice,procurementData?.contracts||[],loadedCguDocuments());
}
function filteredNotices() {
  return (noticesData?.notices||[]).filter(item=>{
    if(!filterStructuredNotice(item,noticesState))return false;
    if(noticesState.modality!=='all' && String(item.modality)!==noticesState.modality)
      return false;
    const evidence=noticeEvidence(item);
    if(noticesState.attribution==='confirmed' && evidence.level!=='confirmed')return false;
    if(noticesState.attribution==='likely'&&evidence.level==='unverified')return false;
    if(noticesState.attribution==='unverified'&&evidence.level!=='unverified')return false;
    const values=[item.pncpId,item.number,item.process,item.object,
      MODALITIES[item.modality],item.unitCode,item.published,item.month,
      item.situation,item.srp?'SRP':'',item.estimatedCents,item.homologatedCents,
      item.disputeMode,item.legalBasisCode,item.proposalStart,item.proposalEnd];
    return !noticesState.query||values.filter(Boolean).join(' ').toLowerCase()
      .includes(noticesState.query);
  });
}
let latestProcurementAudit=null;
function selectedAuditFindings(){
 return filterAuditFindings(latestProcurementAudit?.findings||[],{
  status:$('procurement-audit-filter').value,query:$('procurement-audit-search').value});
}
function renderProcurementEvidenceAudit(){
 const total=state.manifest?.months?.length||0;
 const audit=auditProcurementReferences(procurementData?.contracts||[],loadedCguDocuments(),
  {loadedMonths:cache.size,totalMonths:total});
 $('procurement-audit-status').textContent='Referências conferidas: '+
  fmtCount(audit.counts.verified)+' · não localizadas no histórico publicado: '+
  fmtCount(audit.counts.not_found_in_published_history)+' · conferência incompleta: '+
  fmtCount(audit.counts.not_checked_fully)+' · competências '+fmtCount(audit.loadedMonths)+
  '/'+fmtCount(audit.totalMonths)+'. '+(audit.complete?'Histórico mensal publicado carregado.':
  'Carregue as competências restantes para distinguir referências ainda não conferidas.');
 latestProcurementAudit=audit;
 const filtered=selectedAuditFindings();
 $('procurement-audit-filter-status').textContent=fmtCount(filtered.length)+' de '+fmtCount(audit.findings.length)+' referências exibíveis com os filtros atuais.';
 const tbody=$('procurement-audit-rows');tbody.replaceChildren();
 if(!filtered.length){
  const tr=element('tr'),td=element('td','','Nenhuma referência explícita de NE 158459 encontrada nos instrumentos carregados.');
  td.colSpan=3;tr.append(td);tbody.append(tr);return;
 }
 for(const row of filtered.slice(0,100)){
  const tr=element('tr');
  const status=row.status==='verified'?'Conferida com CGU':
   row.status==='not_found_in_published_history'?'Não localizada no histórico publicado':
   'Conferência histórica incompleta';
  tr.append(element('td','',row.instrument),element('td','',row.reference),element('td','',status));
  tbody.append(tr);
 }
 if(filtered.length>100){
  const tr=element('tr'),td=element('td','','Exibidas as primeiras 100 referências de '+fmtCount(filtered.length)+' filtradas; exporte o CSV para obter todas.');
  td.colSpan=3;tr.append(td);tbody.append(tr);
 }
}
function renderProcurementEvidenceCoverage(){
 if(!noticesData)return;
 const total=state.manifest?.months?.length||0;
 const summary=summarizeProcurementEvidence(noticesData.notices,procurementData?.contracts||[],
  loadedCguDocuments(),cache.size,total);
 const metrics=[
  ['Publicações PNCP',summary.publications],
  ['Com instrumentos vinculados',summary.withInstruments],
  ['Com NE conferida CGU',summary.withVerifiedNe],
  ['Com referência de NE no PNCP',summary.withDeclaredNe],
  ['Somente indícios',summary.withIndications],
  ['Sem evidência identificada',summary.withoutEvidence]
 ];
 const host=$('procurement-evidence-metrics');host.replaceChildren();
 for(const [label,value] of metrics){
  const card=element('div','metric');
  card.append(element('span','small-muted',label),element('strong','',fmtCount(value)));
  host.append(card);
 }
 $('procurement-evidence-summary').textContent='Competências CGU consultadas: '+
  fmtCount(summary.loadedMonths)+' de '+fmtCount(summary.totalMonths)+
  (summary.complete?' · histórico mensal publicado integralmente carregado':
   ' · cobertura parcial, resultados sujeitos a ampliação')+
  '. Contagens referentes às publicações PNCP do catálogo, não ao total de contratações do IFC.';
}
function renderNotices() {
  if(!noticesData)return;
  renderProcurementEvidenceCoverage();
  renderProcurementEvidenceAudit();
  const all=filteredNotices();
  const pages=Math.max(1,Math.ceil(all.length/20));
  noticesState.page=Math.max(0,Math.min(pages-1,noticesState.page));
  $('notices-count').textContent=fmtCount(all.length)+' de '+
    fmtCount(noticesData.notices.length)+' publicações IFC';
  $('notices-page-info').textContent='Página '+(noticesState.page+1)+' de '+pages;
  $('notices-prev').disabled=noticesState.page===0;
  $('notices-next').disabled=noticesState.page>=pages-1;
  const tbody=$('notices-rows');
  tbody.replaceChildren();
  if(!all.length){
    const row=element('tr'),cell=element('td','',
      'Nenhuma publicação correspondente aos filtros ou competências já consultadas.');
    cell.colSpan=7;row.append(cell);tbody.append(row);
    return;
  }
  for(const notice of all.slice(noticesState.page*20,(noticesState.page+1)*20)){
    const row=element('tr');
    const modality=element('td','',MODALITIES[notice.modality]||'Outra modalidade');
    if(notice.srp===true){
      modality.append(element('span','small-muted',' · Registro de preços'));
      modality.title='SRP: licitação pode resultar em ata sem empenho ou contratação imediata';
    }
    const docCell=element('td');
    const url=publicNoticeUrl(notice);
    if(url){
      const link=element('a','doc-code',notice.number||notice.pncpId);
      link.href=url;link.rel='noopener noreferrer';link.target='_blank';
      docCell.append(link);
    }else docCell.append(element('span','doc-code',notice.number||notice.pncpId));
    const linked=groupPublishedInstruments(procurementData?.contracts||[],notice.pncpId);
    const ataCount=(atasData?.atas||[]).filter(a=>a.procurementId===notice.pncpId).length;
    const ataChecked=(atasData?.checks||[]).some(c=>c.procurementId===notice.pncpId);
    const related=element('td','');
    const financial=procurementFinancialEvidence(notice,procurementData?.contracts||[],loadedCguDocuments());
    if(financial.verifiedCommitments){
      const evidence=element('span','small-muted',fmtCount(financial.verifiedCommitments)+' NE(s) Araquari conferida(s) com CGU');
      evidence.title='NE da UG 158459 identificada em documento CGU e vinculada ao instrumento PNCP pelo numero integral ou UG + numero da NE. Nao equivale a quantidade adquirida por item.';
      related.append(evidence);
    }else if(financial.confirmedInstruments){
      const evidence=element('span','small-muted',fmtCount(financial.confirmedInstruments)+' instrumento(s) com referencia de NE 158459 no PNCP');
      evidence.title='Vinculo declarado no PNCP, ainda sem confrontacao com NE CGU carregada. Nao representa despesa liquidada ou paga.';
      related.append(evidence);
    }else if(financial.indicatedInstruments){
      const evidence=element('span','small-muted','Indicios documentais em '+fmtCount(financial.indicatedInstruments)+' instrumento(s)');
      evidence.title='Indicios administrativos ou de NE nao conferida; nao constituem prova de despesa de Araquari.';
      related.append(evidence);
    }
    if(financial.instruments){
      const details=element('details','');
      const summary=element('summary','relation-link','Ver evidências documentais');
      summary.title='Detalhamento dos instrumentos vinculados pelo identificador PNCP e da situação de comprovação de NE da UG 158459.';
      details.append(summary);
      const entries=procurementEvidenceDetails(notice,procurementData?.contracts||[],loadedCguDocuments());
      const list=element('ul','');
      for(const entry of entries){
        const li=element('li','small-muted');
        const status=entry.level==='verified_ne'?'NE conferida com CGU':
          entry.level==='declared_ne'?'Referência de NE no PNCP':
          entry.level==='indication'?'Indício não confirmado':'Sem evidência de Araquari';
        li.append(element('strong','',status),element('span','',' · Instrumento: '+entry.instrument));
        li.append(element('span','',' · '+entry.reason));
        if(entry.commitments.length)li.append(element('span','',' · NE(s): '+entry.commitments.join(', ')));
        list.append(li);
      }
      details.append(list);related.append(details);
    }
    if(ataCount){
      const ataLabel=element('span','small-muted',fmtCount(ataCount)+' ata(s) institucionais identificada(s) no PNCP');
      ataLabel.title='Atas institucionais do órgão publicador. Quantidade licitada, registrada e saldo disponível são indicadores distintos. Não há atribuição automática de quantidades a Araquari nem presunção de compra ou empenho.';
      related.append(ataLabel);
    }else if(notice.srp===true){
      related.append(element('span','small-muted',ataChecked?
        'Nenhuma ata retornada na última consulta PNCP':
        'Atas ainda não consultadas nesta base'));
    }
    if(linked.formal.length) {
      const button=element('button','relation-link',
        linked.formal.length+' contrato(s) formal(is)');
      button.type='button';
      button.title='Vínculo entre a contratação e os termos de contrato pelo ID PNCP. Não equivale à nota de empenho da UG 158459.';
      button.addEventListener('click',()=>{
        contractsState.query=notice.pncpId.toLowerCase();
        contractsState.attribution='all';
        contractsState.source='all';
        contractsState.scope='all';
        contractsState.page=0;
        $('contract-search').value=notice.pncpId;
        $('contract-source').value='all';
        $('contract-scope').value='all';
        $('contract-attribution').value='all';
        renderContracts();
        $('procurement-section').scrollIntoView({behavior:'smooth',block:'start'});
      });
      related.append(button);
    }
    if(linked.commitments.length){
      related.append(element('span','small-muted',
        fmtCount(linked.commitments.length)+' empenho(s) substitutivo(s) no PNCP — não são contratos formais'));
    }
    if(linked.other.length||linked.unclassified.length){
      related.append(element('span','small-muted',
        fmtCount(linked.other.length+linked.unclassified.length)+' outro(s) instrumento(s) sujeito(s) à classificação'));
    }
    if(!linked.formal.length&&!linked.commitments.length&&!linked.other.length&&!linked.unclassified.length){
      related.append(element('span','small-muted',notice.srp===true
        ?'SRP: nenhum contrato ou empenho decorrente identificado nesta base; contratação futura é facultativa'
        :'Nenhum instrumento decorrente identificado nesta base; ausência não comprova pendência'));
    }
    const process=element('td','doc-code',notice.process||'—');
    const details=element('td');
    const open=element('button','details-button','Ver detalhes');
    open.type='button';open.addEventListener('click',()=>showCatalogDetail(notice,'notice'));
    details.append(open);
    const evidence=noticeEvidence(notice);
    const status=element('td','',campusEvidenceLabel(evidence));
    status.title=evidence.reason;
    const value=element('td','align-right',
      Number.isSafeInteger(notice.estimatedCents)?
        fmtMoney(notice.estimatedCents):'Não informado');
    value.title='Estimativa da licitação, não despesa empenhada, contratada ou paga';
    row.append(modality,docCell,related,process,status,value,details);
    tbody.append(row);
  }
}
function renderNoticesCoverage() {
  const coverage=noticesData?.coverage||[];
  if(!coverage.length){
    $('notices-coverage').textContent='Nenhuma modalidade consultada até o momento.';
    $('notices-coverage').className='notice warning';
    return;
  }
  const complete=coverage.filter(c=>c.status==='complete').length;
  const partial=coverage.filter(c=>c.status==='partial').length;
  const missing=coverage.filter(c=>c.status==='unavailable').length;
  $('notices-coverage').textContent='Cobertura PNCP: '+complete+
    ' consultas de modalidade completas; '+partial+' parcial(is); '+missing+
    ' indisponível(is). Modalidades e competências são avaliadas separadamente. '+
    'O filtro inicial destaca possíveis publicações relacionadas a Araquari, '+
    'mas todos os editais da Reitoria continuam acessíveis. '+
    'Registro de preços não exige contratação nem empenho imediato.';
  $('notices-coverage').className='notice'+(partial||missing?' warning':' success');
}
async function initNotices() {
  $('notices-section').hidden=false;
  const selector=$('notices-modality');
  Object.keys(MODALITIES).sort((a,b)=>Number(a)-Number(b)).forEach(key=>{
    const option=element('option','',MODALITIES[key]);option.value=key;
    selector.append(option);
  });
  $('notices-search').addEventListener('input',v=>{
    noticesState.query=v.target.value.trim().toLowerCase();
    noticesState.page=0;renderNotices();
  });
  selector.addEventListener('change',v=>{
    noticesState.modality=v.target.value;noticesState.page=0;renderNotices();
  });
  $('notices-attribution').addEventListener('change',v=>{
    noticesState.attribution=v.target.value;noticesState.page=0;renderNotices();
  });
  $('notices-srp').addEventListener('change',e=>{
    noticesState.srp=e.target.value;noticesState.page=0;renderNotices();
  });
  for(const [id,field] of [['notices-min-value','minCents'],['notices-max-value','maxCents']]){
    $(id).addEventListener('input',e=>{
      const raw=e.target.value.trim(),parsed=parseReaisFilter(raw);
      e.target.setCustomValidity(raw&&parsed===null?'Informe um valor em reais válido.':'');
      noticesState[field]=parsed;noticesState.page=0;renderNotices();
    });
  }
  $('notices-reset').addEventListener('click',()=>{
    noticesState.query='';noticesState.modality='all';noticesState.attribution='likely';
    noticesState.srp='all';noticesState.minCents=null;noticesState.maxCents=null;
    noticesState.page=0;
    $('notices-search').value='';selector.value='all';
    $('notices-srp').value='all';$('notices-min-value').value='';$('notices-max-value').value='';
    $('notices-attribution').value='likely';
    renderNotices();
  });
  $('notices-prev').addEventListener('click',()=>{noticesState.page--;renderNotices();});
  $('notices-next').addEventListener('click',()=>{noticesState.page++;renderNotices();});
  try{
    const response=await fetch('./data/procurement/atas.json',{cache:'no-store'});
    if(response.ok){const parsed=await response.json();
      if(Array.isArray(parsed.atas)&&Array.isArray(parsed.checks))atasData=parsed;}
  }catch{atasData=null;}
  try{
    const response=await fetch('./data/procurement/notices.json',{cache:'no-store'});
    if(!response.ok)throw Error('Catálogo ainda não publicado');
    const data=await response.json();
    if(data?.schema_version!==1||data.publicationUasg!=='158125'||
      !Array.isArray(data.notices)||!Array.isArray(data.coverage))
      throw Error('Dados PNCP incompatíveis');
    noticesData=data;
    renderNoticesCoverage();
    renderNotices();
  }catch{
    noticesData={notices:[],coverage:[]};
    $('notices-coverage').className='notice warning';
    $('notices-coverage').textContent=
      'Aguardando a primeira coleta de licitações e contratações diretas. Nenhuma contratação foi presumida.';
    renderNotices();
  }
}

const tenderItemsState={data:null,query:'',procedure:'all',page:0,loading:false};
function renderTenderItems(){
 const d=tenderItemsState.data;if(!d)return;
 const all=d.procedures.flatMap(p=>p.items.map(item=>({...item,checkedAt:p.checkedAt})));
 const q=tenderItemsState.query;
 const filtered=all.filter(item=>
  (tenderItemsState.procedure==='all'||item.pncpId===tenderItemsState.procedure)&&
  (!q||[item.description,item.pncpId,String(item.number),...(item.results||[]).flatMap(r=>[r.supplierCnpj||'',r.supplierCpfMasked||''])].some(v=>v.toLowerCase().includes(q))));
 const pages=Math.max(1,Math.ceil(filtered.length/25));
 tenderItemsState.page=Math.max(0,Math.min(tenderItemsState.page,pages-1));
 $('tender-items-page-info').textContent='Página '+(tenderItemsState.page+1)+' de '+pages+' · '+fmtCount(filtered.length)+' itens';
 $('tender-items-prev').disabled=tenderItemsState.page===0;
 $('tender-items-next').disabled=tenderItemsState.page>=pages-1;
 const tbody=$('tender-items-rows');tbody.replaceChildren();
 if(!filtered.length){const tr=element('tr'),td=element('td','', 'Nenhum item encontrado nos procedimentos coletados.');td.colSpan=6;tr.append(td);tbody.append(tr);return;}
 for(const item of filtered.slice(tenderItemsState.page*25,(tenderItemsState.page+1)*25)){
  const tr=element('tr'),link=element('a','doc-code',item.pncpId);
  link.href='https://pncp.gov.br/app/editais/'+item.pncpId.replace('-1-','/') ;
  // A URL publica de editais depende do identificador completo do PNCP.
  const m=/^(\d{14})-1-(\d{6})\/(20\d{2})$/.exec(item.pncpId);
  if(m)link.href='https://pncp.gov.br/app/editais/'+m[1]+'/'+m[3]+'/'+Number(m[2]);
  link.target='_blank';link.rel='noopener noreferrer';
  const first=element('td');first.append(link);tr.append(first);
  tr.append(element('td','',item.number),element('td','',item.description),
   element('td','align-right',new Intl.NumberFormat('pt-BR',{maximumFractionDigits:4}).format(item.quantity)),
   element('td','',item.checkedAt));
  const resultCell=element('td');
  if(!Object.hasOwn(item,'results'))resultCell.textContent='Ainda não consultado';
  else if(!item.results.length)resultCell.textContent='Consulta sem resultado informado';
  else{
   const details=element('details'),summary=element('summary','',fmtCount(item.results.length)+' resultado(s)');
   details.append(summary);
   const dec=v=>v===undefined?'Não informado':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:8}).format(Number(v));
   for(const r of item.results){
    const vendor=r.supplierCnpj?'CNPJ '+r.supplierCnpj:r.supplierCpfMasked?'CPF '+r.supplierCpfMasked:r.supplierType==='PE'?'Fornecedor estrangeiro':'Fornecedor não identificado publicamente';
    const description=[vendor,r.status===2?'Cancelado':'Informado','Data: '+localDate(r.date),'Quantidade homologada: '+dec(r.quantity),'Unitário homologado: R$ '+dec(r.unitPrice),r.total!==undefined?'Total informado: R$ '+dec(r.total):null,r.rank?'Classificação SRP: '+r.rank:null,r.reserve===2?'Remanescente':r.reserve===3?'Cadastro de reserva':null,r.cancelledAt?'Cancelado em '+localDate(r.cancelledAt):null].filter(Boolean).join(' · ');
    details.append(element('p','helper',description));
   }
   resultCell.append(details);
  }
  tr.append(resultCell);tbody.append(tr);
 }
}
async function loadTenderItems(){
 if(tenderItemsState.loading)return;
 tenderItemsState.loading=true;$('tender-items-load').disabled=true;
 $('tender-items-coverage').textContent='Carregando itens públicos...';
 try{
  const response=await fetch('./data/procurement/tender-items.json',{cache:'no-store'});
  if(!response.ok)throw Error('Arquivo ainda não publicado');
  const data=await response.json();
  if(data?.schema_version!==1||!Array.isArray(data.procedures))throw Error('Formato inválido');
  tenderItemsState.data=data;
  const sel=$('tender-items-procedure');
  sel.replaceChildren();const all=element('option','','Todas as licitações coletadas');all.value='all';sel.append(all);
  for(const p of data.procedures){
   const opt=element('option','',p.pncpId);opt.value=p.pncpId;sel.append(opt);
  }
  tenderItemsState.procedure='all';tenderItemsState.page=0;
  const count=data.procedures.reduce((n,p)=>n+p.items.length,0);
  $('tender-items-coverage').textContent=fmtCount(count)+' itens de '+fmtCount(data.procedures.length)+
   ' licitações coletadas · '+fmtCount((noticesData?.notices||[]).filter(n=>n.srp===true).length)+
   ' licitações SRP no catálogo. '+fmtCount(data.procedures.reduce((n,p)=>n+p.items.filter(i=>Object.hasOwn(i,'results')).length,0))+' itens com consulta de resultados. Cobertura parcial; valores homologados não equivalem a execução ou saldo de ata.';
  renderTenderItems();
 }catch{
  $('tender-items-coverage').textContent='Itens ainda indisponíveis; a coleta incremental pode estar em andamento.';
 }finally{tenderItemsState.loading=false;$('tender-items-load').disabled=false;}
}
$('procurement-audit-filter').addEventListener('change',()=>{if(latestProcurementAudit)renderProcurementEvidenceAudit();});
$('procurement-audit-search').addEventListener('input',()=>{if(latestProcurementAudit)renderProcurementEvidenceAudit();});
$('procurement-audit-export').addEventListener('click',()=>{
 if(!latestProcurementAudit)return;
 const rows=selectedAuditFindings();
 const csv=auditFindingsCsv(rows);
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const link=document.createElement('a');
 link.href=url;link.download='auditoria-ne-arquari.csv';
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('historical-ne-load').addEventListener('click',loadHistoricalNeEvidence);
function initTenderItems(){
 $('tender-items-load').addEventListener('click',loadTenderItems);
 $('tender-items-search').addEventListener('input',e=>{tenderItemsState.query=e.target.value.trim().toLowerCase();tenderItemsState.page=0;renderTenderItems();});
 $('tender-items-procedure').addEventListener('change',e=>{tenderItemsState.procedure=e.target.value;tenderItemsState.page=0;renderTenderItems();});
 $('tender-items-prev').addEventListener('click',()=>{tenderItemsState.page--;renderTenderItems();});
 $('tender-items-next').addEventListener('click',()=>{tenderItemsState.page++;renderTenderItems();});
}

initTenderItems();
init();
initTrajectories();
initProcurement().then(()=>{if(noticesData)renderNotices();});
initNotices();

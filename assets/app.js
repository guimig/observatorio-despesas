import {buildIntegratedIndex,neEvidenceLevel,instrumentAssociations,scopeFinancialEvidence,trajectoryMatches,itemReferenceCandidates,ataControlFor,scopeItemReferences,noticeAtaItemReferences,ataFilesUrl,contextualEvidenceMatches,cguContractExecutionEvidence} from './integrated-trajectory.js';
import {BUDGET_DIMENSIONS,SIOP_DIMENSIONS,budgetBucket,referenceFor,summarizeBudget,matchesBudgetFilters,budgetFacetOptions} from './budget-classification.js';
import {filterStructuredNotice,filterStructuredContract,filterStructuredAta,filterStructuredTenderItem,validRange,validityStatus,matchesCatalogSearch,compareCatalogDates,parseReaisFilter,isIfcAdhesion,isAraquariAdhesion} from './procurement-structured-filters.js';
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
import {reconcileSiafiCommitment,commitmentChronologyEvidence} from './siafi-movement-reconciliation.js';
import { auditMonth, summarizeDocumentPhases } from './quality.js?v=3';
import { buildCommitmentTrajectories, filterCommitmentTrajectories, auditCommitmentTrajectories } from './trajectory.js';
/** Visualização local de JSONs públicos. Não consulta APIs autenticadas. */
const $ = id => document.getElementById(id);
const fmtMoney = cents => Number.isSafeInteger(cents)
  ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
  : 'Indisponível';
const fmtCount = n => new Intl.NumberFormat('pt-BR').format(n);
const phaseNames = { 1: 'Empenho', 2: 'Liquidação', 3: 'Pagamento' };
const pageSize = 25;
let procurementData=null,siopCatalog=null,cguContractEvidence=[];
let indexedCommitmentCatalog=null,pncpCommitmentIndex=new Map();
function pncpCommitmentEvidence(doc){
  if(doc?.phase!==1||!procurementData)return [];
  if(indexedCommitmentCatalog!==procurementData){
    indexedCommitmentCatalog=procurementData;pncpCommitmentIndex=new Map();
    for(const instrument of procurementData.contracts||[]){
      if(instrument.source!=='pncp'||instrument.commitmentStatus!=='complete')continue;
      for(const detail of instrument.commitmentDetails||[]){
        if(!instrument.commitmentRefs?.includes(detail.id))continue;
        if(!pncpCommitmentIndex.has(detail.id))pncpCommitmentIndex.set(detail.id,[]);
        pncpCommitmentIndex.get(detail.id).push({instrument,detail});
      }
    }
  }
  return pncpCommitmentIndex.get(doc.id)||[];
}
// Indicio separado: revalidar contra o documento CGU atual antes de exibir.
function contextualPncpCommitmentEvidence(doc){
  if(doc?.phase!==1||!procurementData)return [];
  return (procurementData.contracts||[]).filter(c=>c.source==='pncp'&&c.commitmentStatus==='complete'&&
    c.supplierCnpj&&c.supplierCnpj===doc.partyRef&&c.process&&c.process===doc.process)
    .flatMap(instrument=>(instrument.commitmentContext||[])
      .filter(d=>contextualEvidenceMatches(doc,d,loadedCommitmentObservations(doc.id)))
      .map(detail=>({instrument,detail})));
}
let noticesData=null;
let atasData=null;
let arpDetailsById=null,arpParticipationById=null;
const noticesState={query:'',modality:'all',attribution:'likely',srp:'all',minCents:null,maxCents:null,page:0};
const contractsState={query:'',source:'all',scope:'all',attribution:'likely',minCents:null,maxCents:null,activeOn:'',page:0};
const contractsPerPage=20;
const todayBrazil=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateDefaults=kind=>({dateKind:kind,dateFrom:'',dateTo:'',dueFrom:'',dueTo:'',activeOn:'',validity:'all',sort:'recent'});
const ataState={query:'',scope:'all',items:'all',files:'all',adhesion:'all',page:0,...dateDefaults('signed')};
const adhesionState={query:'',kind:'all',page:0,...dateDefaults('signed')};
Object.assign(noticesState,dateDefaults('published'));
Object.assign(contractsState,dateDefaults('signed'));
const validityLabels={current:'Vigente',expired:'Vencida',future:'Futura',unknown:'Datas insuficientes',cancelled:'Cancelada'};
function dateStatus(prefix,s){
 const errors=[];
 if(!validRange(s.dateFrom,s.dateTo))errors.push('Período inválido: a data inicial deve preceder a final.');
 if(!validRange(s.dueFrom,s.dueTo))errors.push('Intervalo de vencimento inválido.');
 if(['contract','notices'].includes(prefix)){
  const lo=$(prefix+'-min-value'),hi=$(prefix+'-max-value');
  if(lo?.value.trim()&&parseReaisFilter(lo.value)===null||hi?.value.trim()&&parseReaisFilter(hi.value)===null)errors.push('Informe valores em reais válidos.');
  if(s.minCents!==null&&s.maxCents!==null&&s.minCents>s.maxCents)errors.push('Valor mínimo não pode superar o máximo.');
 }
 const hint=$(prefix+'-date-hint');
 if(hint){hint.textContent=errors.join(' ')||(s.dateKind==='publishedMonth'?'A fonte informa somente o mês de publicação: o filtro considera os meses que intersectam o intervalo.':s.dateKind==='resultDate'?'O item aparece se algum resultado tiver data no intervalo.':'Limites inclusivos. Campos ausentes não correspondem a filtros de data ativos.');hint.classList.toggle('filter-error',errors.length>0);}
 for(const [x,y] of [['date-from','date-to'],['due-from','due-to']]){
  const start=$(prefix+'-'+x),end=$(prefix+'-'+y);if(start&&end){const valid=validRange(start.value,end.value);start.setAttribute('aria-invalid',String(!valid));end.setAttribute('aria-invalid',String(!valid));}
 }
 return !errors.length;
}
function bindDateFilters(prefix,s,render){
 const fields=[['date-kind','dateKind'],['date-from','dateFrom'],['date-to','dateTo'],['due-from','dueFrom'],['due-to','dueTo'],['active-date','activeOn'],['validity','validity'],['sort','sort']];
 for(const [id,key] of fields){const el=$(prefix+'-'+id);if(!el)continue;el.addEventListener('change',()=>{s[key]=el.value;s.page=0;render();});}
 dateStatus(prefix,s);
}
function resetDates(prefix,s,kind){
 Object.assign(s,dateDefaults(kind));
 for(const [id,key] of [['date-kind','dateKind'],['date-from','dateFrom'],['date-to','dateTo'],['due-from','dueFrom'],['due-to','dueTo'],['active-date','activeOn'],['validity','validity'],['sort','sort']]){const el=$(prefix+'-'+id);if(el)el.value=s[key];}
 dateStatus(prefix,s);
}
function countFilterStatus(prefix,s,results,total,extra=[]){
 const active=[s.query&&'Busca',s.dateFrom||s.dateTo?'Período':'',s.dueFrom||s.dueTo?'Vencimento':'',s.activeOn&&'Vigente em',s.validity&&s.validity!=='all'?'Situação':'',...extra].filter(Boolean);
 const el=$(prefix+'-filter-status');if(el)el.textContent=fmtCount(results)+' de '+fmtCount(total)+' resultados'+(active.length?' · '+active.join(' · '):' · sem filtros adicionais');
}
function compactPagination(host,s,total,perPage,render){
 const pages=Math.max(1,Math.ceil(total/perPage));s.page=Math.max(0,Math.min(pages-1,s.page));
 host.replaceChildren();
 const make=(label,page,disabled=false,current=false)=>{
  const btn=element('button','button button-secondary',label);btn.type='button';btn.disabled=disabled;
  if(current)btn.setAttribute('aria-current','page');btn.addEventListener('click',()=>{s.page=page;render();});return btn;
 };
 host.append(make('«',0,s.page===0),make('‹',s.page-1,s.page===0));
 for(let p=Math.max(0,Math.min(s.page-1,pages-3));p<Math.min(pages,Math.max(0,Math.min(s.page-1,pages-3))+3);p++)host.append(make(String(p+1),p,false,p===s.page));
 host.append(make('›',s.page+1,s.page>=pages-1),make('»',pages-1,s.page>=pages-1));
 return pages;
}
function enrichPagination(prevId,nextId,s,pages,render){
 const prev=$(prevId),next=$(nextId);if(!prev||!next)return;
 const parent=prev.parentElement;if(parent!==next.parentElement)return;
 for(const el of parent.querySelectorAll('[data-extra-page]'))el.remove();
 const make=(label,page,disabled,title,current=false)=>{const el=element('button','button button-secondary',label);el.type='button';el.dataset.extraPage='true';el.disabled=disabled;el.title=title;el.setAttribute('aria-label',title);if(current)el.setAttribute('aria-current','page');el.addEventListener('click',()=>{s.page=page;render();});return el;};
 parent.insertBefore(make('«',0,s.page===0,'Primeira página'),prev);
 const start=Math.max(0,Math.min(s.page-1,pages-3));for(let p=start;p<Math.min(pages,start+3);p++)parent.insertBefore(make(String(p+1),p,false,'Página '+(p+1),p===s.page),next);
 parent.insertBefore(make('»',pages-1,s.page>=pages-1,'Última página'),next.nextSibling);
}
function dateCell(record,{notice=false}={}){
 const cell=element('td','date-cell');
 const add=(label,date)=>{const line=element('span','');line.append(element('span','small-muted',label),element('strong','',date?localDate(date):'—'));cell.append(line);};
 if(notice){add('Publicação',record.published);add('Fim propostas',record.proposalEnd);}
 else{add('Início',record.starts);add('Fim',record.ends);const status=validityStatus(record,todayBrazil());cell.append(element('span','validity-tag validity-'+status,validityLabels[status]));}
 return cell;
}
const cache = new Map();
let commitmentTrajectories=[];
let trajectoryReady=false,trajectoryPage=0;
let integratedMemo=null,integratedHistoryLoading=null;
const state = { manifest: null, month: null, data: null, search: '', phase: 'all', day: 'all', page: 0, budgetDimension:'action',budgetSelections:{},budgetOptionSearch:'',budgetMetric:'count',
  historyYear: null, loadingHistory: false, loadingMonth: false };
const pendingMonths = new Map();
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
});

const views = {
  despesas: ['expenses', 'documents', 'expenses-heading'],
  'trajectory-section': ['expenses', 'trajectory', 'trajectory-title'],
  'resumo-despesas': ['expenses', 'summary', 'summary-title'],
  contratacoes: ['procurement', 'notices', 'procurement-nav-title'],
  'notices-section': ['procurement', 'notices', 'notices-title'],
  'atas-section': ['procurement', 'atas', 'atas-title'],
  'procurement-section': ['procurement', 'contracts', 'procurement-title'],
  'tender-items-panel': ['procurement', 'items', 'items-title'],
  'ifc-adhesions': ['procurement', 'adhesions', 'ifc-adhesions-summary'],
  'cobertura-fontes': ['coverage', null, 'coverage-heading']
};
const initialRoute = () => location.hash.slice(1) || 'despesas';

function showView(route, focus = false) {
  const [area, view, heading] = Object.hasOwn(views, route) ? views[route] : views.despesas;
  for (const section of document.querySelectorAll('[data-workspace]')) {
    section.hidden = section.dataset.workspace !== area;
  }
  for (const section of document.querySelectorAll('[data-view]')) {
    section.hidden = section.dataset.view !== view;
  }
  for (const link of document.querySelectorAll('[data-area], [data-tab]')) {
    const current = link.dataset.area === area || link.dataset.tab === view;
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (view === 'items' && !tenderItemsState.data) loadTenderItems();
  if (view === 'atas') renderAtas();
  if (view === 'adhesions'&&procurementData) renderIfcAdhesions();
  if (area === 'coverage') $('historical-coverage').open = true;
  if (focus) {
    window.scrollTo({top:0, behavior:'instant'});
    $(heading).focus({preventScroll:true});
  }
}
function navigateTo(route) {
  const url = new URL(location.href);
  url.searchParams.delete('competencia');
  url.searchParams.delete('documento');
  url.hash = route;
  if (url.href !== location.href) history.pushState(null, '', url);
  showView(route, true);
}

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
  const isNotice=kind==='notice',isAta=kind==='ata';
  const dialog=$('record-dialog'),fields=$('record-fields');
  if($('document-dialog').open)$('document-dialog').close();
  $('record-title').textContent=isNotice?
    (MODALITIES[record.modality]||'Licitação')+' · '+(record.number||record.pncpId):
    isAta?'Ata de registro de preços · '+(record.number||record.sequence):
    (isFormalContract(record)?'Contrato formal':record.kind||'Instrumento substitutivo')+' · '+(record.number||record.id);
  $('record-eyebrow').textContent=isNotice?'PUBLICAÇÃO PNCP':isAta?'ATA DE REGISTRO DE PREÇOS':'INSTRUMENTO CONTRATUAL';
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
  ]:isAta?[
    ['Controle PNCP da ata',ataControlFor(record)||record.id],
    ['Contratação de origem',record.procurementId],
    ['Número da ata',record.number||record.sequence],
    ['Assinatura',record.signed?localDate(record.signed):'Não informada'],
    ['Início da vigência',record.starts?localDate(record.starts):'Não informado'],
    ['Fim da vigência',record.ends?localDate(record.ends):'Não informado'],
    ['Cancelada',record.cancelled===true?'Sim':record.cancelled===false?'Não':'Não informado'],
    ['Participação administrativa de Araquari',ataParticipationLabel(record.id)]
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
  if(!isNotice&&!isAta&&record.source==='pncp'){
    data.push(['Adesão realizada pelo IFC',isIfcAdhesion(record)?'Sim — IFC aderente':record.adhesion===false?'Não':'Não informado']);
    if(record.ataControl)data.push(['Controle PNCP da ata de origem',record.ataControl]);
    if(record.remanejamento!==undefined)data.push(['Remanejamento informado pelo PNCP',record.remanejamento?'Sim':'Não']);
  }
  if(record.recheckedAt)data.push(['Última reconsulta ao PNCP',localDate(record.recheckedAt)]);
  if(record.sourceUpdatedAt)data.push(['Atualização informada pelo PNCP',
    localDate(record.sourceUpdatedAt)]);
  if(record.lastChangedAt)data.push(['Alteração observada no acervo',
    localDate(record.lastChangedAt)]);
  if(record.revisionCount)data.push(['Revisões materiais observadas',
    String(record.revisionCount)]);
  for(const [label,value] of data)appendDetailField(fields,label,value);
  if(!isAta)appendDetailField(fields,isNotice?'Objeto da licitação':'Objeto do instrumento',
    record.object||'Descrição não disponível na fonte consultada',{long:true});
  renderCatalogEvidence(record,kind);
  renderCatalogTrajectory(record,kind);
  const url=isNotice?publicNoticeUrl(record):isAta?publicAtaUrl(record):publicPncpUrl(record);
  const link=$('record-official-link');
  link.hidden=!url;
  link.textContent=isAta?'Consultar ata oficial no PNCP':'Consultar registro oficial';
  if(url)link.href=url;
  else link.removeAttribute('href');
  showDialogFromTop(dialog);
}
function status(message, kind = '') {
  $('status').className = 'notice' + (kind ? ' ' + kind : '');
  $('status').textContent = message;
  $('status').hidden = !message;
}
function localDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
}
function monthName(month) {
  const date = new Date(month + '-15T12:00:00Z');
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
let chronologyIndexPromise=null;
function loadedCommitmentObservations(id){
 return [...cache.values()].flatMap(m=>(m.commitmentObservations||[]).filter(o=>o.id===id));
}
async function renderCommitmentPeriod(month){
 const amount=$('amount-1'),note=$('count-1'),details=$('commitment-period-details');
 amount.textContent='Consultando movimentos…';note.textContent='Somente operações conciliadas';details.textContent='';
 try{
  chronologyIndexPromise ||= fetch('./data/coverage-index.json',{cache:'no-store'}).then(r=>{
   if(!r.ok)throw Error('Indice indisponivel');return r.json();
  }).catch(e=>{chronologyIndexPromise=null;throw e;});
  const summary=(await chronologyIndexPromise).commitmentChronology;
  if(state.month!==month)return;
  if(!summary)throw Error('Cronologia indisponivel');
  const row=summary.periods[month];
  amount.textContent=row&&row.netCents!==null?fmtMoney(row.netCents):'Sem subtotal conciliado';
  note.textContent=(row?fmtCount(row.identities)+' NEs · '+fmtCount(row.movements)+' operações no período':'Nenhuma operação conciliada no período')+
   ' · '+fmtCount(summary.reconciled)+'/'+fmtCount(summary.identities)+' NEs de 2024 em diante conciliadas';
  details.textContent=row&&row.netCents!==null?
   'Inclusões de itens '+fmtMoney(row.initialCents)+' · Reforços '+fmtMoney(row.reinforcementCents)+
   ' · Anulações '+fmtMoney(row.annulmentCents)+' · Operações de NEs de exercícios anteriores (fora do subtotal): reforços '+fmtMoney(row.priorYearReinforcementCents)+
   ', anulações '+fmtMoney(row.priorYearAnnulmentCents)+', cancelamentos '+fmtMoney(row.priorYearCancellationCents)+'.':
   'Sem evidência suficiente para apurar o subtotal. Ausência não significa valor zero.';
 }catch{
  if(state.month!==month)return;
  amount.textContent='Indisponível';note.textContent='Índice cronológico não disponível';details.textContent='Nenhum valor documental foi utilizado como substituto do fluxo.';
 }
}
function renderStats() {
  $('summary-month').textContent = monthName(state.month) + ' · CGU · UG 158459';
  renderCommitmentPeriod(state.month);
  for (const stat of summarizeDocumentPhases(state.data)) {
    if(stat.phase===1)continue;
    $('amount-' + stat.phase).textContent = stat.cents === null ? 'Sem subtotal verificável' : fmtMoney(stat.cents);
    const notes = [fmtCount(stat.days) + ' de ' + fmtCount(stat.expectedDays) + ' dias encerrados no subtotal'];
    if (stat.missing) notes.push(fmtCount(stat.missing) + ' sem consulta concluída');
    if (stat.unknown) notes.push(fmtCount(stat.unknown) + ' com valores ausentes');
    if (stat.overlap) notes.push(fmtCount(stat.overlap) + ' com documentos em mais de uma fase');
    $('count-' + stat.phase).textContent = notes.join(' · ');
  }
}
function renderQuality() {
  $('monthly-quality').hidden = false;
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
    coverage.status==='sem_dias_encerrados'?'Sem dias encerrados':
    (hasGaps?'Cobertura parcial':'Cobertura completa')+' · '+coverage.completeDays+
    ' de '+coverage.expectedDays+' dias encerrados';
  status(structural?'A auditoria encontrou registros que exigem revisão.':'', structural?'warning':'');
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
function searchText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
function confirmedPi(doc){
 return pncpCommitmentEvidence(doc).map(({detail})=>detail.pi).filter(Boolean);
}
function budgetMatches(doc,except=null){return matchesBudgetFilters(doc,state.budgetSelections,{confirmedPi:confirmedPi(doc),except});}
function toggleBudgetSelection(dimension,key){
 const current=state.budgetSelections[dimension]||[];
 const next=current.includes(key)?current.filter(k=>k!==key):[...current,key];
 if(next.length)state.budgetSelections[dimension]=next;else delete state.budgetSelections[dimension];
 refreshFilters();
}
function budgetSelectionLabel(dimension,key){
 const labels={missing:'Não recuperado / não informado',multiple:'Múltiplas classificações (sem rateio)',context_missing:'Sem ação inequívoca'};
 if(labels[key])return labels[key];
 try{const parts=JSON.parse(key),[year,,action,code]=parts;return year+' · '+(parts.length===3?action:(action?action+' / ':'')+code);}catch{return key;}
}
function filteredDocuments({ignoreBudget=false}={}) {
  const months = state.historyYear
    ? availableMonths(state.historyYear).reverse().map(month => cache.get(month)).filter(Boolean)
    : [state.data];
  const query = searchText(state.search);
  const compactCode = value => searchText(value).replace(/[.\/\s-]/g, '');
  const code = compactCode(query);
  const matches = [];
  for (const data of months) {
    const observed = new Set((data.phaseObservations || [])
      .filter(item => String(item.phase) === state.phase).map(item => item.id));
    const candidates=data.documents.map(doc=>({doc,ownerData:data,listingDate:doc.date,observation:null}));
    for(const observation of data.commitmentObservations||[]){
      const ownerData=cache.get(observation.ownerDate.slice(0,7));
      const doc=ownerData?.documents.find(d=>d.id===observation.id&&d.phase===1&&d.date===observation.ownerDate);
      if(doc)candidates.push({doc,ownerData,listingDate:observation.date,observation});
    }
    for (const {doc,ownerData,listingDate,observation} of candidates) {
      if (state.phase !== 'all' && String(doc.phase) !== state.phase && !observed.has(doc.id)) continue;
      if (state.day !== 'all' && listingDate !== state.day) continue;
      if(!ignoreBudget&&!budgetMatches(doc))continue;
      const codes = [doc.id, doc.process, doc.partyRef].filter(Boolean).map(compactCode);
      const fields = [doc.id, doc.process, doc.cpfMasked, doc.partyRef,
        doc.partyRef && ownerData.beneficiaries?.[doc.partyRef], ...Object.values(doc.nature || {}),
        ...pncpCommitmentEvidence(doc).flatMap(({detail:d})=>[d.pi,d.nature,d.amendment,d.amendmentInfo?.author])];
      const exactCode = code && codes.includes(code);
      if (!query || exactCode || searchText(fields.filter(Boolean).join(' ')).includes(query) ||
          (code && codes.some(value => value.includes(code)))) {
        matches.push({doc,data:ownerData,listingDate,observation});
      }
    }
  }
  const seen=new Set();
  return matches.sort((a,b)=>b.listingDate.localeCompare(a.listingDate)||b.doc.id.localeCompare(a.doc.id))
    .filter(({doc})=>{if(seen.has(doc.id))return false;seen.add(doc.id);return true;});
}
function renderActiveFilters() {
  const root = $('active-filters');
  root.replaceChildren();
  const add = (label, control, resetValue) => {
    const button = element('button', 'filter-chip', label + ' ×');
    button.type = 'button';
    button.setAttribute('aria-label', 'Remover filtro ' + label);
    button.addEventListener('click', () => {
      control.value = resetValue;
      control.dispatchEvent(new Event(control.type === 'search' ? 'input' : 'change'));
      control.focus();
    });
    root.append(button);
  };
  if (state.search) add('Busca: ' + state.search, $('search-doc'), '');
  if (state.day !== 'all') add(localDate(state.day), $('day-filter'), 'all');
  for(const [dimension,keys] of Object.entries(state.budgetSelections))for(const key of keys){
    const label=BUDGET_DIMENSIONS[dimension]+': '+budgetSelectionLabel(dimension,key);
    const chip=element('button','filter-chip',label+' ×');chip.type='button';
    chip.setAttribute('aria-label','Remover filtro '+label);
    chip.addEventListener('click',()=>{toggleBudgetSelection(dimension,key);$('budget-dimension').focus();});
    root.append(chip);
  }
  $('clear-filters').hidden = !root.childElementCount && state.phase === 'all';
  for (const button of document.querySelectorAll('[data-document-phase]')) {
    button.setAttribute('aria-pressed', String(button.dataset.documentPhase === state.phase));
  }
  for (const card of document.querySelectorAll('.stat-card')) {
    card.setAttribute('aria-pressed', String(!state.historyYear && card.dataset.phase === state.phase));
  }
}
function renderDocumentPagination(totalPages) {
  const nav = $('document-pagination');
  nav.hidden = totalPages < 2;
  if (nav.hidden) return;
  const focused = document.activeElement;
  const action = focused?.dataset.pageAction;
  const goTo = page => {
    state.page = page;
    renderTable();
  };
  const first = Math.max(0, Math.min(state.page - 1, totalPages - 3));
  const pages = Array.from({length: Math.min(3, totalPages)}, (_, i) => first + i);
  const controls = [
    ['Primeira', 0, 'Primeira página', 'first', state.page === 0],
    ['Anterior', state.page - 1, 'Página anterior', 'previous', state.page === 0],
    ...pages.map(page => [String(page + 1), page, 'Página ' + (page + 1), 'number', false]),
    ['Próxima', state.page + 1, 'Próxima página', 'next', state.page === totalPages - 1],
    ['Última', totalPages - 1, 'Última página', 'last', state.page === totalPages - 1]
  ];
  nav.replaceChildren(...controls.map(([label, page, accessible, kind, disabled]) => {
    const button = element('button', 'button button-secondary', label);
    button.type = 'button';
    button.dataset.pageAction = kind;
    button.setAttribute('aria-label', accessible);
    if (kind === 'number' && page === state.page) button.setAttribute('aria-current', 'page');
    button.disabled = disabled;
    button.addEventListener('click', () => goTo(page));
    return button;
  }));
  if (action) {
    (nav.querySelector('[data-page-action="' + action + '"]:not(:disabled):not([data-page-action="number"])') ||
      nav.querySelector('[aria-current="page"]')).focus({preventScroll:true});
  }
}
function renderBudgetPanel(base){
 const dimension=state.budgetDimension,selected=state.budgetSelections[dimension]||[];
 const contextual=base.filter(({doc})=>budgetMatches(doc,dimension));
 const groups=summarizeBudget(contextual,dimension,{confirmedPi});
 const facet=budgetFacetOptions(base,dimension,state.budgetSelections,{confirmedPi});
 const known=new Set(facet.map(g=>g.key));
 for(const key of selected)if(!known.has(key))facet.push({key,label:budgetSelectionLabel(dimension,key),compatible:0,count:0});
 const selectionCount=Object.values(state.budgetSelections).reduce((n,keys)=>n+keys.length,0);
 $('budget-filter-count').textContent=selectionCount?' · '+selectionCount+' selecionado(s)':'';
 const dimensions=$('budget-dimension-list');dimensions.replaceChildren();
 for(const [key,keys] of Object.entries(state.budgetSelections)){
  const btn=element('button','filter-chip',BUDGET_DIMENSIONS[key]+' · '+keys.length);
  btn.type='button';btn.setAttribute('aria-pressed',String(key===dimension));btn.addEventListener('click',()=>{state.budgetDimension=key;state.budgetOptionSearch='';$('budget-dimension').value=key;$('budget-option-search').value='';renderTable();});dimensions.append(btn);
 }
 const hostOptions=$('budget-options'),focusKey=document.activeElement?.dataset?.budgetKey,previousScroll=hostOptions.scrollTop;
 hostOptions.replaceChildren();
 const q=searchText(state.budgetOptionSearch);
 const visible=facet.filter(g=>!q||searchText(g.label+' '+(referenceFor(siopCatalog,g,dimension)||'')).includes(q)).sort((x,y)=>Number(selected.includes(y.key))-Number(selected.includes(x.key))||y.compatible-x.compatible||x.label.localeCompare(y.label,'pt-BR'));
 for(const g of visible){
  const label=element('label','facet-option'),check=element('input');check.type='checkbox';check.checked=selected.includes(g.key);check.dataset.budgetKey=g.key;
  check.addEventListener('change',()=>toggleBudgetSelection(dimension,g.key));
  const caption=element('span','',g.label);const count=element('span','facet-count',fmtCount(g.compatible));
  count.title='Documentos compatíveis com os outros filtros; total antes desses filtros: '+fmtCount(g.count);
  label.append(check,caption,count);hostOptions.append(label);
  if(focusKey===g.key)check.focus({preventScroll:true});
 }
 if(!visible.length)hostOptions.append(element('p','helper','Nenhuma classificação para a busca neste período.'));
 hostOptions.scrollTop=previousScroll;
 $('budget-clear').disabled=!selectionCount;
 $('budget-all-history').disabled=state.loadingHistory||state.loadingMonth||state.historyYear==='all';
 const single=['1','2','3'].includes(state.phase);
 $('budget-metric').options[1].disabled=!single;
 if(!single)state.budgetMetric='count';
 $('budget-metric').value=state.budgetMetric;
 const missing=groups.filter(g=>g.kind==='missing').reduce((n,g)=>n+g.count,0);
 const multiple=groups.filter(g=>g.kind==='multiple').reduce((n,g)=>n+g.count,0);
 const knownCount=contextual.length-missing-multiple;
 $('budget-coverage').textContent=fmtCount(contextual.length)+' documentos compatíveis com as outras dimensões · '+
  fmtCount(knownCount)+' classificados · '+fmtCount(missing)+' não recuperados/sem contexto · '+fmtCount(multiple)+' múltiplos'+
  (state.loadingHistory?' · cobertura em carregamento':' · somente competências carregadas')+
  (state.budgetDimension==='pi'?' · somente identidade SIAFI integral declarada no PNCP':'');
 const host=$('budget-bars');host.replaceChildren();
 const byValue=state.budgetMetric==='value'&&single;
 const metric=g=>byValue?Math.abs(g.phase[Number(state.phase)].cents):g.count;
 const ranked=[...groups].sort((a,b)=>metric(b)-metric(a)||b.count-a.count).slice(0,10);
 const max=Math.max(1,...ranked.map(metric));
 for(const g of ranked){
  const button=element('button','budget-bar-button');button.type='button';
  button.setAttribute('aria-pressed',String(selected.includes(g.key)));
  const title=element('span','budget-bar-label',g.label);
  const ref=referenceFor(siopCatalog,g,state.budgetDimension);
  if(ref)title.append(element('span','small-muted','SIOP: '+ref));
  const amount=element('span','budget-bar-value',fmtCount(g.count)+' doc.');
  if(single){
   const p=g.phase[Number(state.phase)];
   amount.textContent=p.known?fmtMoney(p.cents)+' · '+fmtCount(p.known)+' com valor': 'Valor indisponível';
   if(p.unknown)amount.textContent+=' · '+fmtCount(p.unknown)+' sem valor';
   if(p.count!==g.count)amount.textContent+=' · '+fmtCount(g.count-p.count)+' de outra fase original';
   if(!byValue)amount.textContent=fmtCount(g.count)+' doc. · '+amount.textContent;
   if(state.phase==='1')amount.title='Valores documentais de referência; não representam movimentação por data';
  }
  const track=element('progress','budget-bar-progress');track.max=max;track.value=metric(g);
  track.setAttribute('aria-label',g.label+' · '+amount.textContent);
  button.append(title,amount,track);
  button.addEventListener('click',()=>{toggleBudgetSelection(dimension,g.key);});
  host.append(button);
 }
 if(groups.length>10)host.append(element('p','small-muted','10 de '+fmtCount(groups.length)+' grupos; todos disponíveis no filtro.'));
 if(!groups.length)host.append(element('p','small-muted','Nenhum documento no recorte consultado.'));
}
function renderSiopReference(){
 const year=$('siop-year').value,kind=$('siop-kind').value,q=searchText($('siop-search').value);
 const host=$('siop-rows');host.replaceChildren();
 const d=siopCatalog?.dictionaries?.find(x=>String(x.year)===year);
 if(!d){$('siop-status').textContent='Catálogo de referência ainda indisponível para este exercício.';return;}
 const rows=d.rows.filter(r=>r.kind===kind&&(!q||searchText([r.action,r.code,r.label].filter(Boolean).join(' ')).includes(q)));
 $('siop-status').textContent=year+' · '+fmtCount(rows.length)+' códigos correspondentes · '+fmtCount(d.conflicts)+' conflitos omitidos na fonte normalizada';
 for(const r of rows.slice(0,100)){
  const row=element('div','siop-reference-row');
  row.append(element('strong','',r.action?r.action+' / '+r.code:r.code),element('span','',r.label));host.append(row);
 }
 if(rows.length>100)host.append(element('p','small-muted','100 primeiros resultados; refine a busca.'));
}
async function loadSiopReference(){
 try{
  const response=await fetch('./data/siop/dictionaries.json',{cache:'no-store'});
  if(!response.ok)throw Error('SIOP não publicado');
  const data=await response.json();
  if(data.schema_version!==1||data.source!=='SIOP'||data.uo!=='26422'||!Array.isArray(data.dictionaries)||
    data.dictionaries.some(d=>!Number.isInteger(d.year)||d.year<2024||!Array.isArray(d.rows)))throw Error('Catálogo SIOP inválido');
  siopCatalog=data;
  $('siop-year').replaceChildren(...data.dictionaries.slice().reverse().map(d=>new Option(String(d.year),String(d.year))));
 }catch{siopCatalog=null;}
 renderSiopReference();if(state.data)renderTable();
}
function renderTable() {
  const base=filteredDocuments({ignoreBudget:true});
  renderBudgetPanel(base);
  const all=base.filter(({doc})=>budgetMatches(doc));
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  state.page = Math.min(Math.max(0, state.page), totalPages - 1);
  const shown = all.slice(state.page * pageSize, (state.page + 1) * pageSize);
  $('table-count').textContent = fmtCount(all.length) + (all.length === 1 ? ' resultado' : ' resultados');
  $('export-button').disabled = !all.length || state.loadingHistory || state.loadingMonth;
  $('page-information').textContent = all.length
    ? 'Página ' + fmtCount(state.page + 1) + ' de ' + fmtCount(totalPages) +
      ' · ' + fmtCount(state.page * pageSize + 1) + '–' + fmtCount(state.page * pageSize + shown.length) +
      ' de ' + fmtCount(all.length) : '';
  renderActiveFilters();
  renderDocumentPagination(totalPages);
  const body = $('doc-rows');
  body.replaceChildren();
  if (!shown.length) {
    const row = element('tr');
    const message = state.loadingHistory ? 'Carregando os documentos do período…'
      : 'Nenhum documento corresponde aos filtros nas competências consultadas.';
    const td = element('td', '', message);
    if (state.search && state.historyYear !== 'all' && !state.loadingHistory) {
      const expand = element('button', 'button button-ghost', 'Buscar no histórico');
      expand.type = 'button';
      expand.addEventListener('click', () => {
        $('search-doc').focus({preventScroll:true});
        searchHistory('all');
      });
      td.append(expand);
    }
    td.colSpan = 7;
    row.append(td); body.append(row);
    return;
  }
  shown.forEach(({doc, data,listingDate,observation}) => {
    const row = element('tr');
    const id = element('td', 'doc-code', doc.id);
    id.append(element('span', 'mobile-document-meta', localDate(listingDate) + ' · ' + (phaseNames[doc.phase] || 'Outro')));
    const date = element('td', 'document-mobile-hidden', localDate(listingDate));
    if(observation)date.append(element('span','small-muted integrated-table-note','Reaparição CGU'));
    if(doc.phase===1)date.title='Data de listagem CGU, não necessariamente emissão';
    const phase = element('td', 'document-mobile-hidden');
    phase.append(element('span', 'phase-label', phaseNames[doc.phase] || 'Outro'));
    const others=(data.phaseObservations||[]).filter(item=>item.id===doc.id);
    if(others.length)phase.append(element('span','small-muted',
      ' · também consta em '+others.map(item=>phaseNames[item.phase]).join(', ')));
    const beneficiary = element('td', 'beneficiary-cell document-secondary', beneficiaryLabel(doc,data));
    const process = element('td', 'doc-code document-secondary', doc.process || '—');
    const amount = element('td', 'align-right', fmtMoney(doc.cents));
    if(observation)amount.append(element('span','small-muted integrated-table-note','Reconsulta: '+fmtMoney(observation.cents)));
    if(doc.phase===1)amount.title='Valor documental de referência, não fluxo do período';
    const details = element('td');
    const button = element('button', 'details-button');
    button.append(element('span', 'document-mobile-hidden', 'Ver detalhes'), element('span', 'mobile-document-meta', 'Abrir'));
    button.type = 'button';
    button.setAttribute('aria-label', 'Ver detalhes do documento ' + doc.id);
    button.addEventListener('click', () => showDocument(doc, data));
    details.append(button);
    row.append(id, date, phase, beneficiary, process, amount, details);
    row.addEventListener('click', event => {
      if (event.target === button) return;
      button.focus({preventScroll:true});
      showDocument(doc, data);
    });
    body.append(row);
  });
}
async function fetchMonth(month) {
  if (cache.has(month)) return cache.get(month);
  if (!pendingMonths.has(month)) {
    const request = (async () => {
      const response = await fetch('./data/months/' + month + '.json', {cache:'no-store'});
      if (!response.ok) throw Error('Arquivo mensal indisponível');
      const data = await response.json();
      if (data?.schema_version !== 1 || data.unit !== '158459' || data.month !== month ||
          !Array.isArray(data.documents) || !Array.isArray(data.coverage) ||
          !Array.isArray(data.relations)) throw Error('Dados mensais incompatíveis');
      cache.set(month, data);
      return data;
    })().finally(() => pendingMonths.delete(month));
    pendingMonths.set(month, request);
  }
  return pendingMonths.get(month);
}
async function loadObservationOwners(months){
 const names=new Set(months.flatMap(m=>(m.commitmentObservations||[]).map(o=>o.ownerDate.slice(0,7))));
 await Promise.allSettled([...names].filter(m=>state.manifest.months.includes(m)).map(fetchMonth));
}
let locatorPromise=null;
async function relationshipLocator(){
 locatorPromise ||= fetch('./data/relationship-index.json',{cache:'no-store'}).then(async r=>{
  if(!r.ok)throw Error('Índice indisponível');const x=await r.json();
  if(x.schema_version!==1||x.unit!=='158459'||!x.owners||!x.neighbors||x.manifestWrite!==(state.manifest.updated_at||null)||
    JSON.stringify(x.months)!==JSON.stringify([...state.manifest.months].sort()))throw Error('Índice incompatível');
  return x;
 }).catch(()=>{locatorPromise=null;return null;});
 return locatorPromise;
}
async function loadContractCompetencies(refs){
 if(!state.manifest)return false;
 const x=await relationshipLocator();if(!x)return false;
 const months=[...new Set(refs.flatMap(id=>[...(x.owners[id]||[]),...(x.neighbors[id]||[])]))].filter(m=>state.manifest.months.includes(m));
 let ok=months.length>0;
 for(let i=0;i<months.length;i+=4){const results=await Promise.allSettled(months.slice(i,i+4).map(fetchMonth));if(results.some(r=>r.status!=='fulfilled'))ok=false;}
 return ok;
}
async function loadLinkedCompetencies(id){
 const x=await relationshipLocator();
 if(!x)return false;
 const months=[...new Set([...(x.owners[id]||[]),...(x.neighbors[id]||[])])].filter(m=>state.manifest.months.includes(m));
 if(!months.length)return false;
 const results=await Promise.allSettled(months.map(fetchMonth));
 return results.every(r=>r.status==='fulfilled');
}
async function locateLinkedDocument(id) {
  for (const data of cache.values()) {
    const doc = data.documents.find(entry => entry.id === id);
    if (doc) return {doc, data};
  }
  const locator=await relationshipLocator();
  if(locator?.owners[id]?.length){
    await Promise.allSettled(locator.owners[id].filter(m=>state.manifest.months.includes(m)).map(fetchMonth));
    for(const data of cache.values()){const doc=data.documents.find(d=>d.id===id);if(doc)return {doc,data};}
  }
  let unavailable = false;
  for (const month of [...state.manifest.months].sort().reverse()) {
    if (cache.has(month)) continue;
    try {
      const data = await fetchMonth(month);
      const doc = data.documents.find(entry => entry.id === id);
      if (doc) return {doc, data};
    } catch { unavailable = true; }
  }
  if (unavailable) throw Error('Há competências indisponíveis');
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
    await fetchMonth(month);completed++;
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
let evidenceMemo=null;
function evidenceContext(){
 const months=[...cache.values()];
 if(!evidenceMemo||evidenceMemo.procurement!==procurementData||months.length!==evidenceMemo.months.length||months.some((m,i)=>m!==evidenceMemo.months[i])){
  evidenceMemo={months,procurement:procurementData,docs:months.flatMap(m=>m.documents),contracts:new WeakMap(),notices:new WeakMap()};
 }
 return evidenceMemo;
}
function loadedCguDocuments(){return evidenceContext().docs;}
function campusEvidence(contract){
 const ctx=evidenceContext();
 if(!ctx.contracts.has(contract))ctx.contracts.set(contract,assessContractAttribution(contract,ctx.docs));
 return ctx.contracts.get(contract);
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
function integratedIndex(){
 const signature=[...cache.values(),state.manifest?.months?.length,procurementData,noticesData,atasData,arpDetailsById,tenderItemsState.data,cguContractEvidence];
 if(integratedMemo&&signature.length===integratedMemo.signature.length&&signature.every((v,i)=>v===integratedMemo.signature[i]))return integratedMemo.index;
 const index=buildIntegratedIndex({months:[...cache.values()],contracts:procurementData?.contracts||[],
  notices:noticesData?.notices||[],atas:atasData?.atas||[],arpDetails:[...(arpDetailsById?.values()||[])],
  tender:tenderItemsState.data,cguContracts:cguContractEvidence,totalMonths:state.manifest?.months?.length||0});
 integratedMemo={signature,index};return index;
}
const evidenceLabels={confirmed:'NE integral conferida',declared_ne:'NE integral declarada; CGU não localizada',
 contextual_candidate:'Candidato contextual · não confirmado',high_confidence:'Correspondência de alta confiança · não confirmada',ne_indication:'NE abreviada / unidade · indício',
 context:'Processo e CNPJ · indício',process:'Mesmo processo · indício'};
const instrumentTitle=c=>(isFormalContract(c)?'Contrato formal':c.kind||'Instrumento')+' · '+(c.number||c.pncpId||c.id);
function relationButton(label,action){
 const b=element('button','relation-link',label);b.type='button';b.addEventListener('click',action);return b;
}
function externalNoticeLink(id,label){
 const url=publicNoticeUrl({pncpId:id});
 if(!url)return element('span','small-muted',label);
 const a=element('a','inline-link',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;
}
function ataParticipationLabel(id){
 const check=arpParticipationById?.get(id);
 if(!check)return 'Consulta pendente';
 const roles={1:'gerenciador',2:'participante',3:'não participante'};
 if(check.campusRoles?.length)return 'Papel confirmado na fonte: '+check.campusRoles.map(r=>roles[r]).join(', ');
 if(check.candidateRoles?.length)return 'CNPJ do campus localizado; papel candidato: '+check.candidateRoles.map(r=>roles[r]).join(', ')+' (unidade não homologada)';
 return 'Nenhum papel confirmado na consulta; não prova ausência de participação';
}
function renderOriginButtons(host,index,instrumentId){
 for(const p of index.noticeEdges.get(instrumentId)||[]){
  const name='Licitação / contratação '+(p.notice?.number||p.purchaseId);
  const route=p.sources.includes('controle_compra_instrumento')?'Contratação informada no instrumento':'Contratação de origem da ata (pode ser distinta da adesão)';
  const row=element('div','integrated-origin');
  row.append(element('span','small-muted',route));
  row.append(p.notice?relationButton(name,()=>showCatalogDetail(p.notice,'notice')):externalNoticeLink(p.purchaseId,name+' · fora do catálogo local'));
  host.append(row);
 }
 const aa=index.ataEdges.get(instrumentId)||[];
 if(aa.length>1)host.append(element('p','helper','Mais de uma ata específica declarada; não alocar valores por ata.'));
 for(const a of aa){
  const row=element('div','integrated-origin');
  row.append(element('span','small-muted','Ata específica · '+a.sources.map(s=>s==='controle_ata_instrumento'?'controle informado no instrumento':'consulta direta da ata').join(' + ')));
  if(a.ata)row.append(relationButton('Ata '+(a.ata.number||a.ata.sequence),()=>showCatalogDetail(a.ata,'ata')));
  else{
    const m=/^(\d{14})-1-(\d{6})\/(20\d{2}):ata:(\d+)$/.exec(a.ataId);
    if(m){const link=element('a','inline-link','Ata '+a.ataId+' · consultar no PNCP');link.href='https://pncp.gov.br/api/pncp/v1/orgaos/'+m[1]+'/compras/'+m[3]+'/'+Number(m[2])+'/atas/'+Number(m[4]);link.target='_blank';link.rel='noopener noreferrer';row.append(link);}
    else row.append(element('span','small-muted',a.ataId+' · não localizada no catálogo'));
  }
  host.append(row);
 }
}
function historyControl(host,index,refresh){
 host.append(element('p','helper','Competências CGU carregadas: '+fmtCount(index.loadedMonths)+' de '+fmtCount(index.totalMonths)+
  '. Acervo publicado parcial em relação à execução real; ausência de relação não comprova ausência de despesa.'));
 if(!index.complete&&index.totalMonths){
  const button=relationButton('Conferir todas as competências publicadas',async()=>{
   button.disabled=true;button.textContent='Consultando histórico publicado…';
   try{
    if(!integratedHistoryLoading)integratedHistoryLoading=(async()=>{
     for(const month of state.manifest.months)try{await fetchMonth(month)}catch{/* preserva lacuna */}
    })().finally(()=>{integratedHistoryLoading=null;});
    await integratedHistoryLoading;
    if(button.isConnected)refresh();
    if(trajectoryReady)renderCommitmentTrajectories();
   }finally{button.disabled=false;}
  });
  host.append(button);
 }
}
async function openIntegratedNe(id,button){
 await loadLinkedCompetencies(id);
 let entry=integratedIndex().byNe.get(id);
 if(!entry?.document){
  button.disabled=true;const label=button.textContent;button.textContent='Localizando NE…';
  try{await locateLinkedDocument(id);entry=integratedIndex().byNe.get(id);}
  catch{/* origem pode continuar ausente */}
  finally{button.disabled=false;button.textContent=label;}
 }
 if(!button.isConnected)return;
 if(entry){
  if($('record-dialog').open)$('record-dialog').close();
  showCommitmentTrajectory(entry);
 }else button.textContent='NE ainda não localizada no acervo';
}
function neButton(id){
 const b=element('button','relation-link doc-code',id);b.type='button';
 b.addEventListener('click',()=>openIntegratedNe(id,b));return b;
}
function cguContractLink(row){
 const a=element('a','inline-link','Consultar contrato na CGU');a.href='https://portaldatransparencia.gov.br/contratos/'+row.id;a.target='_blank';a.rel='noopener noreferrer';return a;
}
function cguContractTitle(row){return 'Contrato CGU · '+(row.number?row.number+' · ':'')+'ID '+row.id;}
const cguGroupMoney=g=>g.known?fmtMoney(g.cents):'Indisponível';
function renderCguContractExecution(host,row){
 host.replaceChildren();
 const index=integratedIndex(),e=cguContractExecutionEvidence(index,row.id);
 const summary=element('div','relation-item integrated-edge');
 summary.append(element('strong','','Execução documental vinculada · UG 158459'),
  element('p','helper',fmtCount(e.located)+' de '+fmtCount(e.references)+' NEs localizadas · '+fmtCount(e.reconciled)+' de '+fmtCount(e.eligible)+' NEs elegíveis com histórico conciliado · '+fmtCount(index.loadedMonths)+' de '+fmtCount(index.totalMonths)+' competências carregadas. Subtotais parciais, não saldos do contrato.'));
 const movementLabels={initialCents:'Inclusões originais dos itens',reinforcementCents:'Reforços',annulmentCents:'Anulações',cancellationCents:'Cancelamentos de RAP',reconstructedCents:'Valor reconstituído dos itens conciliados'};
 for(const [key,label] of Object.entries(movementLabels)){
  const group=e.movements[key];
  summary.append(element('p','small-muted',label+': '+cguGroupMoney(group)+' · '+fmtCount(group.known)+' NE(s) conciliadas'+(group.unknown?' · '+fmtCount(group.unknown)+' pendentes':'')));
 }
 for(const [key,label] of [['liquidation','Impactos de liquidação'],['payment','Impactos de pagamento']]){
  const group=e[key];
  financialMetric(summary,label,group,' · '+fmtCount(group.documents)+' documentos distintos · '+fmtCount(group.neWithoutKnown)+' NE(s) elegíveis sem impacto monetário disponível');
 }
 if(e.missing.length||e.ambiguous.length||e.conflicts.length)summary.append(element('p','helper',fmtCount(e.missing.length)+' NE(s) ainda não localizadas · '+fmtCount(e.ambiguous.length)+' compartilhadas entre contratos CGU · '+fmtCount(e.conflicts.length)+' com conflito documental. Excluídas dos subtotais.'));
 summary.append(element('p','helper','A associação CGU–NE não comprova equivalência com PNCP. Movimentações de itens somente após conciliação integral; impactos somente por NE, sem ratear documentos inteiros. Ausência de valor não significa zero.'));
 host.append(summary);
 const detail=element('details','integrated-items');detail.open=true;detail.append(element('summary','relation-link','Notas de empenho declaradas pela CGU · '+fmtCount(e.references)));
 const statuses={missing:'NE ainda não localizada',ambiguous:'NE compartilhada; não alocada',conflict:'Conflito documental; não alocada',reconciled:'Histórico conciliado',pending:'Histórico pendente',partial:'Histórico parcial',divergent:'Histórico divergente',unavailable:'Histórico indisponível'};
 for(const item of e.rows){
  const block=element('div','relation-item');
  block.append(neButton(item.ne),element('span','small-muted',statuses[item.status]||'Histórico pendente'));
  if(item.chronology?.status==='reconciled')block.append(element('span','small-muted','Primeira inclusão de item: '+localDate(item.chronology.originalDate)+' · última movimentação: '+localDate(item.chronology.lastMovementDate)+' · valor reconstituído: '+fmtMoney(item.chronology.reconstructedCents)));
  if(item.chronology){
   block.append(element('span','small-muted','Impactos recuperados: liquidação '+cguGroupMoney(item.liquidation)+' · pagamento '+cguGroupMoney(item.payment)));
   for(const [label,links] of [['Liquidações',item.liquidationLinks],['Pagamentos',item.paymentLinks]]){
    if(!links.length)continue;
    const list=element('details','integrated-items'),body=element('div');
    list.append(element('summary','relation-link',label+' · '+fmtCount(links.length)),body);
    renderTrajectoryLinks(body,links,'Nenhum documento localizado');block.append(list);
   }
  }
  detail.append(block);
 }
 host.append(detail);
 if(e.periods.length){
  const timeline=element('details','integrated-items');timeline.append(element('summary','relation-link','Movimentações por competência · '+fmtCount(e.periods.length)));
  timeline.append(element('p','helper','Movimentos de itens pela data do evento. Liquidações e pagamentos pela data documental de referência da CGU; não são datas de baixa ou saldo.'));
  for(const p of e.periods){
   const block=element('div','relation-item');block.append(element('strong','',monthName(p.month)));
   for(const [k,label] of [...Object.entries(movementLabels).filter(([k])=>k!=='reconstructedCents'),['liquidation','Liquidação (impactos)'],['payment','Pagamento (impactos)']])if(p[k]?.known)block.append(element('span','small-muted',label+': '+cguGroupMoney(p[k])));
   timeline.append(block);
  }host.append(timeline);
 }
 const candidate=index.cguEvidence.byCgu.get(row.id);
 if(candidate){
  const c=index.instruments.get(candidate.instrumentId);
  if(c){
   const block=element('div','relation-item integrated-edge');
   block.append(element('strong','','Correspondência candidata PNCP'),relationButton(instrumentTitle(c),()=>showCatalogDetail(c,'instrument')),element('span','small-muted',candidate.reason));
   renderOriginButtons(block,index,candidate.instrumentId);host.append(block);
  }
 }else host.append(element('p','helper','Nenhuma correspondência PNCP única com evidência suficiente no acervo carregado.'));
 if(!index.complete){
  const control=relationButton('Carregar competências relacionadas',async()=>{
   control.disabled=true;control.textContent='Carregando competências…';
   const ok=await loadContractCompetencies(row.refs).catch(()=>false);
   if(host.dataset.cguContract!==String(row.id)||!$('record-dialog').open||!control.isConnected)return;
   renderCguContractExecution(host,row);
   if(!ok)host.append(element('p','helper','Índice indisponível ou acervo parcial. Consulte o histórico completo na aba Trajetória.'));
   else host.append(element('p','helper','Competências localizadas pelo índice carregadas. A cobertura da fonte continua parcial.'));
  });
  host.append(control);
 }
}
function showCguContractEvidence(row){
 if($('document-dialog').open)$('document-dialog').close();
 $('record-title').textContent=cguContractTitle(row);$('record-eyebrow').textContent='CONTRATO · PORTAL DA TRANSPARÊNCIA';
 const fields=$('record-fields');fields.replaceChildren();
 for(const [label,value] of [['Identificador CGU',String(row.id)],['Número do contrato',row.number],['Processo administrativo',row.process],['UG administrativa',row.unitCode],['Unidade gestora de compras',row.buyingUnit],['Assinatura',row.signed?localDate(row.signed):null],['Referência temporal da fonte',localDate(row.reference)]])appendDetailField(fields,label,value);
 $('record-evidence-section').hidden=true;
 const host=$('record-trajectory');host.dataset.cguContract=String(row.id);renderCguContractExecution(host,row);
 const link=$('record-official-link');link.hidden=false;link.href='https://portaldatransparencia.gov.br/contratos/'+row.id;link.textContent='Consultar registro oficial CGU';
 showDialogFromTop($('record-dialog'));
}
function renderNeAdministrative(host,index,id){
 const edges=[...(index.neEdges.get(id)||[])].sort((a,b)=>Number(b.level==='confirmed')-Number(a.level==='confirmed'));
 const direct=index.cguEvidence.byNe.get(id)||[];
 for(const row of direct){const block=element('div','relation-item integrated-edge');block.append(element('strong','','Relação contrato–NE declarada pela CGU'),relationButton(cguContractTitle(row),()=>showCguContractEvidence(row)),cguContractLink(row),element('span','small-muted','Identidade SIAFI integral; independente da confirmação de instrumento PNCP.'));host.append(block);}
 if(!edges.length&&!direct.length){host.append(element('p','small-muted','Nenhum vínculo administrativo encontrado para '+id+' nos catálogos consultados.'));return;}
 for(const e of edges.slice(0,30)){
  const c=index.instruments.get(e.instrumentId);if(!c)continue;
  const block=element('div','relation-item integrated-edge');
  block.append(element('strong','',evidenceLabels[e.level]||e.level),
   relationButton(instrumentTitle(c),()=>showCatalogDetail(c,'instrument')),
   element('span','small-muted',e.reason));
  renderOriginButtons(block,index,e.instrumentId);
  host.append(block);
 }
 if(edges.length>30)host.append(element('p','helper','Exibidas 30 de '+fmtCount(edges.length)+' correspondências. Refine pela contratação ou consulte a ficha do instrumento.'));
}
function renderItemCrossReferences(host,index,entry,refresh){
 if(!entry?.items?.some(i=>i.purchaseItem))return;
 const references=itemReferenceCandidates(index,entry);
 const box=element('details','integrated-items');
 box.append(element('summary','relation-link','Conferência de itens da contratação e da ata'));
 box.append(element('p','helper','Correspondência candidata pelo número do item extraído da descrição CGU e pelo identificador da contratação. Não comprova equivalência de unidades de medida, consumo, saldo ou vínculo por subitem de liquidação/pagamento.'));
 if(!tenderItemsState.data)box.append(relationButton('Carregar catálogo de itens licitados',async()=>{
  await loadTenderItems();if(box.isConnected)refresh();
 }));
 for(const r of references.slice(0,50)){
  const row=element('div','relation-item');
  row.append(element('strong','','Item NE '+r.seq+' · item da compra '+r.number),element('span','small-muted',r.evidence==='candidate'?'Vínculo administrativo candidato; não confirmado':'NE integral conferida; item candidato'));
  if(r.tender)row.append(element('span','small-muted','PNCP: '+r.tender.description+' · quantidade licitada informada: '+r.tender.quantity));
  if(r.ataItem){
   row.append(element('span','small-muted','Ata '+(r.ata.number||r.ata.sequence)+' · mesmo item e CNPJ; quantidade homologada do fornecedor: '+(r.ataItem.homologatedSupplier??'não informada')));
   if(r.ataItem.committedQuantity!==undefined)row.append(element('span','small-muted','Quantidade empenhada declarada no Compras.gov para o item: '+r.ataItem.committedQuantity+' (não saldo da UG)'));
   for(const unit of r.unitRecords)row.append(element('span','small-muted','Registro UASG '+unit.unitCode+': '+unit.registered+' (não necessariamente reserva do campus)'));
  }
  box.append(row);
 }
 if(references.length>50)box.append(element('p','helper','Exibidas 50 de '+fmtCount(references.length)+' correspondências candidatas.'));
 if(!references.length)box.append(element('p','small-muted','Nenhuma correspondência inequívoca de catálogo para comparar os itens; não inferir a partir de outra compra/ata.'));
 host.append(box);
}
function showContractAssociations(doc,{entry=null}={}){
 const slot=$('dialog-contracts');slot.replaceChildren();
 const index=integratedIndex(),refresh=()=>showContractAssociations(doc,{entry:entry?integratedIndex().byNe.get(entry.id)||entry:null});
 if(!procurementData)slot.append(element('p','small-muted','Catálogo de instrumentos ainda indisponível.'));
 if(entry||doc?.phase===1){
  const id=entry?.id||doc.id;
  renderNeAdministrative(slot,index,id);
  renderItemCrossReferences(slot,index,index.byNe.get(id)||entry,refresh);
 }else if(doc){
  const origins=index.originsByDoc.get(doc.id)||[];
  if(!origins.length)slot.append(element('p','small-muted','Sem NE impactada localizada. Não atribuir a contratação diretamente por processo/fornecedor do pagamento ou liquidação.'));
  for(const {entry:origin,link} of origins){
   const block=element('div','relation-item');
   block.append(element('span','small-muted',link.cents===null?
     'NE relacionada pela CGU · valor do impacto não recuperado':
     'NE impactada pela CGU · '+fmtMoney(link.cents)+(link.relatedCgu?' · também declarada em documentos relacionados':'')),neButton(origin.id));
   renderNeAdministrative(block,index,origin.id);slot.append(block);
  }
 }
 historyControl(slot,index,refresh);
}
function financialMetric(host,label,group,extra=''){
 host.append(element('p','small-muted',label+': '+(group.known?fmtMoney(group.cents):'Indisponível')+
  ' · '+fmtCount(group.known)+' vínculo(s)/documento(s) com valor'+(group.unknown?' · '+group.unknown+' sem valor seguro':'')+extra));
}
function renderCatalogEvidence(record,kind){
 const section=$('record-evidence-section'),host=$('record-evidence');host.replaceChildren();
 delete host.dataset.ataId;
 section.hidden=kind!=='notice'&&kind!=='ata';if(section.hidden)return;
 $('record-evidence-title').textContent=kind==='notice'?'Evidências documentais e atas':'Itens, unidades e documentos da ata';
 if(kind==='notice'){
  const entries=procurementEvidenceDetails(record,procurementData?.contracts||[],loadedCguDocuments());
  for(const entry of entries){
   const status=entry.level==='verified_ne'?'NE conferida com CGU':entry.level==='declared_ne'?'Referência de NE no PNCP':entry.level==='indication'?'Indício não confirmado':'Sem evidência de Araquari';
   const row=element('div','relation-item');row.append(element('strong','',status),element('p','small-muted','Instrumento: '+entry.instrument+' · '+entry.reason+(entry.commitments.length?' · NE(s): '+entry.commitments.join(', '):'')));host.append(row);
  }
  if(!entries.length)host.append(element('p','helper','Nenhuma evidência documental de instrumento no catálogo carregado.'));
  const atas=(atasData?.atas||[]).filter(a=>a.procurementId===record.pncpId);
  if(atas.length){
   host.append(element('h3','',fmtCount(atas.length)+' atas da contratação'));
   for(const ata of atas){
    const row=element('div','relation-item'),detail=arpDetailsById?.get(ata.id);
    row.append(relationButton('Ata '+(ata.number||ata.sequence),()=>showCatalogDetail(ata,'ata')),
     element('span','small-muted',detail?.compras?fmtCount(detail.compras.items.length)+' registros de item/fornecedor recuperados':'Itens ainda não recuperados'));
    const url=publicAtaUrl(ata);if(url){const link=element('a','inline-link','PNCP · ata oficial');link.href=url;link.target='_blank';link.rel='noopener noreferrer';row.append(link);}
    host.append(row);
   }
  }else if(record.srp===true)host.append(element('p','helper',(atasData?.checks||[]).some(c=>c.procurementId===record.pncpId)?'Nenhuma ata retornada na última consulta completa.':'Atas ainda não consultadas nesta base.'));
  const index=integratedIndex(),refs=noticeAtaItemReferences(index,record.pncpId);
  const box=element('details','integrated-items');box.append(element('summary','relation-link','Itens registrados em atas · '+fmtCount(refs.length)+' registros item/fornecedor'));
  if(!tenderItemsState.data)box.append(relationButton('Carregar descrições dos itens licitados',async()=>{
   await loadTenderItems();if(box.isConnected)renderCatalogEvidence(record,kind);
  }));
  if(!refs.length)box.append(element('p','helper','Nenhum item de ata recuperado nesta base; não significa ausência de itens registrados.'));
  for(const ref of refs.slice(0,100)){
   const row=element('div','relation-item');
   row.append(element('strong','','Item '+ref.item.number+(ref.tender?.description?' · '+ref.tender.description:'')),
    element('span','small-muted',(ref.item.supplierCnpj?'CNPJ '+ref.item.supplierCnpj:'Fornecedor '+ref.item.supplierCpfMasked)+(ref.item.excluded?' · Excluído':'')),
    relationButton('Ata '+(ref.ata.number||ref.ata.sequence),()=>showCatalogDetail(ref.ata,'ata')));
   box.append(row);
  }
  if(refs.length>100)box.append(element('p','helper','Exibidos 100 registros; consulte as fichas individuais das atas para todos os itens.'));
  host.append(box);return;
 }
 const detail=arpDetailsById?.get(record.id);
 const tender=tenderItemsState.data?.procedures?.find(p=>p.pncpId===record.procurementId);
 if(!tenderItemsState.data){
  host.append(relationButton('Carregar descrições dos itens licitados',async()=>{
   await loadTenderItems();
   if($('record-dialog').open&&$('record-evidence').dataset.ataId===record.id)renderCatalogEvidence(record,kind);
  }));
 }
 host.dataset.ataId=record.id;
 if(!detail?.compras)host.append(element('p','helper','Itens da ata ainda não recuperados pelo Compras.gov.br. Itens licitados não demonstram, por si sós, sua inclusão nesta ata.'));
 else{
  host.append(element('p','helper','Itens comprovados pelo controle oficial da ata. Descrição vinculada somente pela mesma contratação e número de item. Quantidades totais da ata não são saldo de Araquari.'));
  for(const i of detail.compras.items){
   const match=tender?.items?.filter(t=>t.number===i.number&&t.pncpId===record.procurementId)||[];
   const row=element('div','relation-item');
   row.append(element('strong','','Item '+i.number+(match.length===1&&match[0].description?' · '+match[0].description:'')));
   const parts=[i.supplierCnpj?'CNPJ '+i.supplierCnpj:'CPF '+i.supplierCpfMasked,i.excluded?'Excluído':null,i.homologatedSupplier!==undefined?'Homologado fornecedor: '+i.homologatedSupplier:null,i.committedQuantity!==undefined?'Quantidade empenhada informada: '+i.committedQuantity:null,i.unitPrice!==undefined?'Unitário informado (R$): '+i.unitPrice:null,i.totalPrice!==undefined?'Total informado (R$): '+i.totalPrice:null];
   row.append(element('p','small-muted',parts.filter(Boolean).join(' · ')));host.append(row);
  }
 }
 if(!detail?.unitItems?.some(i=>i.units.some(u=>u.unitCode==='158459')))host.append(element('p','helper','Quantidade de Araquari sem registro confirmado nesta base.'));
 if(detail?.unitItems?.length){
  host.append(element('p','helper','Registros administrativos por unidade; não comprovam reserva interna por campus.'));
  for(const entry of detail.unitItems)for(const u of entry.units)host.append(element('div','relation-item','Item '+entry.number+' · '+(u.unitCode==='158459'?'UASG Araquari':'UASG Reitoria')+' · Quantidade registrada: '+u.registered+(u.sourceUpdatedAt?' · Atualização '+localDate(u.sourceUpdatedAt):'')));
 }
 const filesBox=element('div','relation-item');
 filesBox.append(element('strong','','Documentos oficiais da ata · PNCP'));
 const url=ataFilesUrl(record);
 if(url){
  const files=element('a','inline-link','Consultar lista oficial no PNCP');files.href=url;files.target='_blank';files.rel='noopener noreferrer';filesBox.append(files);
  if(!detail||!Object.hasOwn(detail,'files'))filesBox.append(element('p','helper','Links individuais ainda não catalogados.'));
  else if(!detail.files.length)filesBox.append(element('p','helper','Nenhum arquivo retornado na última consulta completa.'));
  else for(const f of detail.files){
   const link=element('a','inline-link','Abrir documento '+f.seq+(f.published?' · '+localDate(f.published):''));
   link.href=ataFilesUrl(record,f.seq);link.target='_blank';link.rel='noopener noreferrer';filesBox.append(link);
  }
  filesBox.append(element('p','helper','Os arquivos permanecem no PNCP. O Observatório registra somente identificadores e metadados mínimos, sem cópia de PDF.'));
 }
 host.append(filesBox);
 if(detail&&Object.hasOwn(detail,'instruments')){
  const block=element('div','relation-item');block.append(element('strong','','Instrumentos IFC consultados diretamente na ata'));
  if(!detail.instruments.length)block.append(element('p','helper','Nenhum instrumento do IFC retornado na consulta completa.'));
  for(const i of detail.instruments){
   const link=element('a','inline-link',i.pncpId+(i.unitCode?' · unidade '+i.unitCode:'')+(i.adhesion===true?' · adesão do IFC':''));
   const target=publicPncpUrl({source:'pncp',pncpId:i.pncpId});if(target){link.href=target;link.target='_blank';link.rel='noopener noreferrer';block.append(link);}
  }
  host.append(block);
 }
}
function renderCatalogTrajectory(record,kind){
 const host=$('record-trajectory');delete host.dataset.cguContract;host.replaceChildren();
 const index=integratedIndex(),refresh=()=>renderCatalogTrajectory(record,kind);
 const id=kind==='notice'?record.pncpId:kind==='ata'?record.id:record.id||record.pncpId;
 const scope=kind==='notice'||kind==='ata'?kind:'instrument';
 if(scope==='instrument'){
  renderOriginButtons(host,index,id);
  for(const row of index.cguEvidence.byPncp.get(id)||[]){const block=element('div','relation-item');block.append(element('strong','','Possível contrato correspondente na CGU'),relationButton(cguContractTitle(row),()=>showCguContractEvidence(row)),element('span','small-muted',index.cguEvidence.byCgu.get(row.id)?.reason+' Excluído dos totais PNCP.'));host.append(block);}
 }
 if(scope==='ata'){
  const notice=index.noticeMap.get(record.procurementId);
  host.append(notice?relationButton('Contratação de origem · '+(notice.number||notice.pncpId),()=>showCatalogDetail(notice,'notice')):
   externalNoticeLink(record.procurementId,'Contratação de origem · '+record.procurementId));
 }
 if(scope==='notice'){
  const aa=index.byAtaPurchase.get(id)||[];
  if(aa.length)host.append(element('p','helper','Consulte as '+fmtCount(aa.length)+' atas na seção Evidências documentais e atas acima.'));
 }
 const associations=instrumentAssociations(index,scope,id);
 if(scope!=='instrument'){
  const details=element('details','integrated-items');
  details.append(element('summary','relation-link','Instrumentos vinculados por identificador oficial · '+fmtCount(associations.length)));
  for(const e of associations){
   const c=index.instruments.get(e.instrumentId);if(!c)continue;
   const row=element('div','relation-item');row.append(relationButton(instrumentTitle(c),()=>showCatalogDetail(c,'instrument')));
   if(scope==='notice')row.append(element('span','small-muted',e.sources.map(s=>s==='origem_da_ata'?'Via ata de origem':'Contratação informada no instrumento').join(' + ')));
   for(const candidate of index.cguEvidence.byPncp.get(e.instrumentId)||[])row.append(relationButton('Candidato CGU · '+(candidate.number||candidate.id),()=>showCguContractEvidence(candidate)),element('span','small-muted','Correspondência não confirmada; execução CGU independente da ficha PNCP.'));
   details.append(row);
  }
  host.append(details);
 }
 const finance=scopeFinancialEvidence(index,scope,id);
 const summary=element('div','relation-item integrated-edge');
 summary.append(element('strong','','Execução documental vinculada · UG 158459'),
  element('span','small-muted',fmtCount(finance.confirmed.length)+' NE(s) integrais conferidas · '+fmtCount(finance.declared.length)+' declaradas sem NE local · '+fmtCount(finance.candidates.length)+' somente indícios'));
 financialMetric(summary,'Valores documentais das NEs elegíveis',finance.commitment);
 financialMetric(summary,'Impactos de liquidação disponíveis',finance.liquidation,' · '+fmtCount(finance.liquidation.documents)+' documentos distintos');
 financialMetric(summary,'Impactos de pagamento disponíveis',finance.payment,' · '+fmtCount(finance.payment.documents)+' documentos distintos');
 if(finance.excluded.length)summary.append(element('p','helper',fmtCount(finance.excluded.length)+' NE(s) sem alocação de valores por ambiguidades ou divergências.'));
 summary.append(element('p','helper','Somente NE integral e um único instrumento confirmado; valores de impactos CGU por NE, sem rateio do documento inteiro. Não são saldos, execução líquida, percentual de consumo, nem valores exclusivos entre fichas de licitação e ata.'));
 host.append(summary);
 for(const [title,rows] of [['NEs integrais conferidas',finance.confirmed],['Referências integrais ainda não localizadas',finance.declared],['Indícios sem confirmação financeira',finance.candidates]]){
  if(!rows.length)continue;
  const details=element('details','integrated-items');
  details.append(element('summary','relation-link',title+' · '+fmtCount(rows.length)));
  for(const row of rows){
   const block=element('div','relation-item');
   block.append(neButton(row.ne),element('span','small-muted',uniqueReasons(row.edges)));
   if(finance.excluded.includes(row.ne))block.append(element('span','small-muted','Valores excluídos do agrupamento por ambiguidade/divergência.'));
   details.append(block);
  }
  host.append(details);
 }
 const cross=scopeItemReferences(index,scope,id);
 const crossBox=element('details','integrated-items');
 crossBox.append(element('summary','relation-link','Vínculos candidatos por item de empenho · '+fmtCount(cross.length)),
  element('p','helper','Instrumento único confirmado ou candidato de alta confiança e número de item da compra. Candidatos não compõem totais financeiros. Ata exige mesmo controle de compra, item e CNPJ; não rateia liquidação, pagamento ou saldo.'));
 if(!tenderItemsState.data)crossBox.append(relationButton('Carregar catálogo de itens licitados',async()=>{
  await loadTenderItems();if(crossBox.isConnected)refresh();
 }));
 for(const r of cross.slice(0,100)){
  const row=element('div','relation-item');
  row.append(element('strong','','Item da compra '+r.number+(r.tender?.description?' · '+r.tender.description:'')),
   neButton(r.ne),element('span','small-muted','Item NE '+r.seq+(r.evidence==='candidate'?' · vínculo administrativo candidato':' · NE integral conferida')));
  if(r.ata)row.append(relationButton('Ata '+(r.ata.number||r.ata.sequence),()=>showCatalogDetail(r.ata,'ata')));
  const c=index.instruments.get(r.instrumentId);
  if(c&&scope!=='instrument')row.append(relationButton(instrumentTitle(c),()=>showCatalogDetail(c,'instrument')));
  crossBox.append(row);
 }
 if(!cross.length)crossBox.append(element('p','helper','Nenhuma correspondência de item validável no acervo carregado.'));
 if(cross.length>100)crossBox.append(element('p','helper','Exibidas 100 correspondências; consulte as NEs para todos os itens.'));
 host.append(crossBox);
 historyControl(host,index,refresh);
}
function uniqueReasons(edges){return [...new Set(edges.map(e=>(evidenceLabels[e.level]||e.level)+' · '+e.reason))].join(' | ');}
function appendCommitmentChronologyFields(fields,doc,items){
 if(!doc)return;
 const observations=loadedCommitmentObservations(doc.id);
 const a=commitmentChronologyEvidence(doc,items,observations);
 appendDetailField(fields,'Data original de emissão','Não comprovada pela listagem diária da CGU');
 appendDetailField(fields,'Primeira inclusão identificada nos itens',a.status==='reconciled'&&a.originalDate?localDate(a.originalDate)+' · inclusão de item, não prova autônoma de emissão':'Histórico conciliado insuficiente');
 appendDetailField(fields,'Última movimentação conciliada',a.status==='reconciled'?localDate(a.lastMovementDate):'Não comprovada');
 appendDetailField(fields,'Valor atual dos itens conciliado',a.status==='reconciled'?fmtMoney(a.reportedCents):'Não comprovado');
 appendDetailField(fields,'Datas em que a NE consta na listagem carregada',(a.listingDates||[doc.date]).map(localDate).join(' · '));
 if(observations.length)appendDetailField(fields,'Valores observados em outras datas da listagem CGU',observations.map(o=>localDate(o.date)+' · '+fmtMoney(o.cents)).join('; ')+' (não constituem valores de reforço ou anulação)',{long:true});
}
function explainSiafiReconciliation(items,doc){
 const a=reconcileSiafiCommitment(items,{listingDate:doc?.date,
   documentCents:doc?commitmentChronologyEvidence(doc,items,loadedCommitmentObservations(doc.id)).referenceCents:null,commitmentYear:doc?.id?.slice(11,15)});
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
   documentCents:doc?commitmentChronologyEvidence(doc,items,loadedCommitmentObservations(doc.id)).referenceCents:null});
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
   'Todos os itens consultados apresentam somente uma inclusão na data da listagem, com valores coincidentes. Isso não comprova a emissão documental. Isso é conferência documental, não conciliação de saldo contábil.';
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
   '. A data da listagem não comprova a emissão original do empenho.';
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
  if($('record-dialog').open)$('record-dialog').close();
  $('dialog-trajectory-section').hidden=true;
  $('dialog-relations-title').hidden=false;
  $('dialog-title').textContent = doc.id;
  $('document-trajectory').hidden = doc.phase !== 1;
  const permalink = new URL(location.pathname, location.origin);
  permalink.searchParams.set('competencia', monthData.month);
  permalink.searchParams.set('documento', doc.id);
  $('document-permalink').href = permalink;
  $('document-permalink').hidden = false;
  const fields = $('dialog-fields');
  fields.replaceChildren();
  const entries = [
    ['Unidade gestora', '158459 · IFC Araquari'],
    ['Data informada na listagem CGU', localDate(doc.date)],
    ['Processo administrativo', doc.process || 'Não informado'],
    [doc.valueSource==='impactos_cgu'?'Valor recuperado dos impactos CGU':'Valor documental', fmtMoney(doc.cents)],
    ['Fonte', 'CGU / Portal da Transparência'],
    ['Favorecido', beneficiaryLabel(doc,monthData)],
    ['Espécie do documento', documentSpecies(doc).label],
    ['Fase de divulgação original', financialPhaseDescription(doc.phase)],
    ['Outros filtros da CGU em que aparece',
      (monthData.phaseObservations||[]).filter(o=>o.id===doc.id)
        .map(o=>phaseNames[o.phase]+(o.amountRelation==='different'?
          ' (valor informado divergente)':o.amountRelation==='unknown'?
          ' (comparação de valores indisponível)':' (mesmo valor informado)'))
        .join('; ')||'Nenhum outro filtro identificado'],
    ['Categoria econômica', doc.nature?.economicCategory || 'Não informada pela CGU'],
    ['Grupo de despesa', doc.nature?.group || 'Não informado'],
    ['Elemento', doc.nature?.element || 'Não informado'],
    ['Função', doc.nature?.function || 'Não informada pela CGU'],
    ['Subfunção', doc.nature?.subfunction || 'Não informada pela CGU'],
    ['Programa', doc.nature?.program || 'Não informado'],
    ['Ação orçamentária', doc.nature?.action || 'Não informada'],
    ['Plano orçamentário (PO)', doc.nature?.budgetPlan || 'Não informado pela CGU'],
    ['Localizador de gasto', doc.nature?.locator || 'Não informado pela CGU'],
    ['Subtítulo', doc.nature?.subtitle || 'Não informado pela CGU'],
    ['Modalidade orçamentária (CGU)',doc.nature?.applicationMode || 'Não informada pela CGU'],
    ...(doc.nature?.amendmentAuthor?[['Autor informado pela CGU',doc.nature.amendmentAuthor]]:[]),
    ['Consulta de vínculos',doc.phase===3
      ?(doc.paymentLinksChecked?'Concluída nesta base':'Aguardando enriquecimento')
      :doc.phase===2?(doc.liquidationLinksChecked?'Concluída nesta base':
        'Aguardando consulta dos empenhos impactados'):'Conforme documentos disponíveis']
  ];
  for(const [label,value] of entries)appendDetailField(fields,label,value);
  const references=Object.keys(BUDGET_DIMENSIONS).flatMap(kind=>{
    const bucket=budgetBucket(doc,kind),label=referenceFor(siopCatalog,bucket,kind);
    return label?[BUDGET_DIMENSIONS[kind]+': '+label]:[];
  });
  if(references.length)appendDetailField(fields,'Referência SIOP · códigos coincidentes da UO',references.join('\n'),{long:true});
  if(doc.phase===1){
    const evidence=pncpCommitmentEvidence(doc);
    const unique=key=>[...new Set(evidence.map(({detail})=>detail[key]).filter(v=>v!==undefined))].join(' · ');
    appendDetailField(fields,'Plano interno (PI) · PNCP',
      unique('pi')||'Não recuperado com identidade SIAFI integral');
    const context=contextualPncpCommitmentEvidence(doc);
    if(context.length){
      appendDetailField(fields,'Evidência candidata PNCP (vínculo não confirmado)',
        context.slice(0,12).map(({instrument,detail:d})=>
          (d.pi?'PI '+d.pi+' · ':'')+instrument.pncpId+' / registro '+d.seq+' · emissão declarada PNCP '+localDate(d.issueDate)+
          (d.nature?' · ND '+d.nature:'')+(d.amendment?' · Emenda '+d.amendment:'')).join('\n')+
        '\nCoincidem número abreviado, processo, CNPJ e valor documental observado. A data de emissão é declarada pelo PNCP e não equiparada à listagem CGU. O PNCP não informou a identidade SIAFI integral. Não utilizado em totais ou classificação oficial.',{long:true});
    }
    if(evidence.length){
      if(unique('nature'))appendDetailField(fields,'ND informada no PNCP',unique('nature'));
      if(unique('amendment'))appendDetailField(fields,'Emenda informada no PNCP',unique('amendment'));
      appendDetailField(fields,'Evidências PNCP · por registro, valores não somados',
        evidence.slice(0,12).map(({instrument,detail:d})=>[
          'Instrumento '+instrument.pncpId+' / registro '+d.seq,
          d.pi&&'PI '+d.pi,d.nature&&'ND '+d.nature,
          d.issueDate&&'Emissão PNCP '+localDate(d.issueDate),
          d.status&&('Situação PNCP: '+(d.status===1?'Empenhado':'Cancelado')),
          d.statusDate&&'Data da situação '+localDate(d.statusDate),
          d.totalCents!==undefined&&'Total declarado '+fmtMoney(d.totalCents),
          d.subitemCents!==undefined&&'Subitem '+fmtMoney(d.subitemCents),
          d.amendment&&'Emenda '+d.amendment,d.amendmentInfo?.author,
          d.included&&'Inclusão '+localDate(d.included),
          d.updated&&'Atualização '+localDate(d.updated)
        ].filter(Boolean).join(' · ')).join('\n')+
        (evidence.length>12?'\nMais '+(evidence.length-12)+' registro(s) no catálogo.':''),
        {long:true});
    }
  }
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
  // As identidades oficiais adicionais nao entram em relations nem recebem
  // o valor integral de um documento que pode impactar varias NEs.
  const index=integratedIndex();
  const additional=doc.phase===1?(index.byNe.get(doc.id)?.links||[])
    .filter(l=>l.cents===null).map(l=>({from:l.id,to:doc.id,cents:null})):
    (index.originsByDoc.get(doc.id)||[]).filter(x=>x.link.cents===null)
    .map(x=>({from:doc.id,to:x.entry.id,cents:null}));
  for(const r of additional)if(!relationsMap.has(r.from+'/'+r.to))relationsMap.set(r.from+'/'+r.to,r);
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
      item.append(element('span','small-muted',relation.cents===null?'Documento relacionado pela CGU · sem valor de impacto':label));
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
      item.append(button,element('strong','',relation.cents===null?'Valor por NE não recuperado':'Valor vinculado: '+fmtMoney(relation.cents)));
      list.append(item);
    }
  }
  if(doc.phase===1)appendCommitmentChronologyFields(fields,doc,monthData.itemsByDocument?.[doc.id]);
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
const monthLabel = new Intl.DateTimeFormat('pt-BR', {month:'long', timeZone:'UTC'});
function availableMonths(year) {
  return state.manifest.months.filter(month => year === 'all' || month.slice(0, 4) === year).sort();
}
function selectPeriod() {
  const year = state.historyYear ?? state.month.slice(0, 4);
  $('year-select').value = year;
  const selector = $('month-select');
  selector.replaceChildren(new Option('Todos', 'all'));
  if (year !== 'all') {
    selector.append(...availableMonths(year).map(value =>
      new Option(monthLabel.format(new Date(value + '-15T12:00:00Z')), value)));
  }
  selector.value = state.historyYear ? 'all' : state.month;
}
function setPeriodBusy(busy) {
  $('year-select').disabled = busy;
  $('month-select').disabled = busy || state.historyYear === 'all';
  $('day-filter').disabled = busy || Boolean(state.historyYear);
}
function renderDays() {
  const days = [...new Set([...state.data.coverage, ...state.data.documents]
    .map(item => item.date).filter(date => date.startsWith(state.month + '-')))].sort();
  const selector = $('day-filter');
  selector.replaceChildren(element('option', '', 'Todos'));
  selector.firstChild.value = 'all';
  days.forEach(day => {
    const option = element('option', '', day.slice(8));
    option.value = day;
    selector.append(option);
  });
  selector.value = 'all'; state.day = 'all';
}
function renderAll() {
  renderDays(); renderStats(); renderQuality(); renderTable();
  $('updated').textContent = state.data.updated_at
    ? 'Arquivo atualizado em ' + dateTime.format(new Date(state.data.updated_at)) + ' (Brasília)'
    : 'Sem registro de atualização';
}

async function loadAllTrajectoryMonths(){
  if(trajectoryReady || !state.manifest)return;
  $('trajectory-status').textContent='Carregando competências para reconstruir as trajetórias…';
  const months=[...state.manifest.months].sort();
  const loaded=[];
  for(let i=0;i<months.length;i+=4){const group=await Promise.allSettled(months.slice(i,i+4).map(fetchMonth));for(const x of group)if(x.status==='fulfilled')loaded.push(x.value);}
  if(loaded.length!==months.length){renderCommitmentTrajectories();throw Error('Competências indisponíveis');}
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
function renderRelationshipCatalog(query,index){
 const host=$('trajectory-catalog-results');if(!host)return;host.replaceChildren();
 const kind=$('trajectory-catalog-kind').value;
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const q=norm(query);if(!q){host.append(element('p','small-muted','Pesquise para localizar registros administrativos ou financeiros, inclusive os ainda sem NE vinculada.'));return;}
 const records=[];
 const push=(type,record,label,search,action)=>{
   if(kind!=='all'&&kind!==type)return;
   if(norm([label,...search].join(' ')).includes(q))records.push({label,action});
 };
 for(const d of index.docs.values())if(d.phase!==1)push(d.phase===2?'liquidation':'payment',d,d.id,[d.description,d.process],()=>{const m=cache.get(d.month)||[...cache.values()].find(m=>m.documents.some(x=>x.id===d.id));if(m)showDocument(d,m);});
 for(const c of index.cguEvidence.records.values())push('cgu_contract',c,cguContractTitle(c),[c.process,c.number,c.unitCode,...c.refs],()=>showCguContractEvidence(c));
 for(const c of index.instruments.values())push('instrument',c,instrumentTitle(c),[c.pncpId,c.object,c.process,c.supplierName,c.supplierCnpj],()=>showCatalogDetail(c,'instrument'));
 for(const n of index.noticeMap.values())push('notice',n,'Licitação / contratação '+n.number,[n.pncpId,n.process,n.object],()=>showCatalogDetail(n,'notice'));
 for(const a of index.ataMap.values())push('ata',a,'Ata '+(a.number||a.sequence),[a.id,ataControlFor(a),index.noticeMap.get(a.procurementId)?.object],()=>showCatalogDetail(a,'ata'));
 host.append(element('p','small-muted',fmtCount(records.length)+' registros correspondentes · competências financeiras carregadas '+fmtCount(cache.size)));
 for(const row of records.slice(0,40))host.append(relationButton(row.label,row.action));
 if(records.length>40)host.append(element('p','helper','Exibidos 40 registros; refine a pesquisa.'));
}
function renderCommitmentTrajectories(){
  const query=$('trajectory-search').value;
  const index=integratedIndex(),level=$('trajectory-evidence').value;
  renderRelationshipCatalog(query,index);
  const all=index.entries.filter(entry=>trajectoryMatches(index,entry,query)&&
    (level==='all'||(level==='cgu'?index.cguEvidence.byNe.has(entry.id):level==='high'?(index.neEdges.get(entry.id)||[]).some(e=>['high_confidence','contextual_candidate'].includes(e.level)):neEvidenceLevel(index,entry.id)===level)));
  const pages=Math.max(1,Math.ceil(all.length/25));trajectoryPage=Math.max(0,Math.min(pages-1,trajectoryPage));
  $('trajectory-prev').disabled=trajectoryPage===0;$('trajectory-next').disabled=trajectoryPage===pages-1;
  $('trajectory-page-info').textContent='Página '+fmtCount(trajectoryPage+1)+' de '+fmtCount(pages);
  const tbody=$('trajectory-rows');tbody.replaceChildren();
  $('trajectory-count').textContent=fmtCount(all.length)+' empenho(s) com registro ou vínculo · '+fmtCount(cache.size)+' competências carregadas';
  if(!all.length){
    const row=element('tr'),cell=element('td','','Nenhum empenho corresponde à pesquisa.');
    cell.colSpan=7;row.append(cell);tbody.append(row);return;
  }
  for(const entry of all.slice(trajectoryPage*25,(trajectoryPage+1)*25)){
    const row=element('tr');
    const ne=element('td','doc-code',entry.id);
    const date=element('td','',entry.document?.date?localDate(entry.document.date):'NE não coletada');
    const process=element('td','doc-code',entry.document?.process||'—');
    const object=element('td','beneficiary-cell',entry.document?.nature?.element||'Não informado');
    const e=neEvidenceLevel(index,entry.id);
    object.append(element('span','small-muted integrated-table-note',index.cguEvidence.byNe.has(entry.id)?'Contrato–NE declarado pela CGU':e==='confirmed'?'NE integral conferida':e==='indication'?'Indício administrativo':'Sem vínculo administrativo identificado'));
    const lq=element('td','align-right',fmtMoney(entry.liquidationCents));
    const pg=element('td','align-right',fmtMoney(entry.paymentCents));
    if(!entry.liquidations.length)lq.textContent='Não identificado';
    if(!entry.payments.length)pg.textContent='Não identificado';
    if(entry.liquidationUnknown)lq.append(element('span','small-muted integrated-table-note',fmtCount(entry.liquidationUnknown)+' sem valor por NE'));
    if(entry.paymentUnknown)pg.append(element('span','small-muted integrated-table-note',fmtCount(entry.paymentUnknown)+' sem valor por NE'));
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
    item.append(element('span','small-muted',link.cents===null?
      'CGU · documento relacionado; valor do impacto por NE não recuperado':
      'Valor vinculado: '+fmtMoney(link.cents)+(link.relatedCgu?' · também declarado em documentos relacionados':'')));
    item.append(element('span','small-muted',link.checked===true?'Consulta de vínculos concluída':
      link.checked===false?'Consulta de vínculos pendente':'Documento relacionado não localizado no acervo carregado'));
    if(link.document){
      const open=element('button','relation-link doc-code','Abrir documento');
      open.type='button';open.addEventListener('click',()=>showDocument(link.document,cache.get(link.month)||state.data));
      item.append(open);
    }else{
      const open=relationButton('Localizar documento '+link.id,async()=>{
        open.disabled=true;
        try{const found=await locateLinkedDocument(link.id);
          if(found&&open.isConnected)showDocument(found.doc,found.data);
          else open.textContent='Documento ainda não localizado';
        }catch{open.textContent='Consulta do acervo indisponível';}
        finally{open.disabled=false;}
      });item.append(open);
    }
    target.append(item);
  }
}
function showCommitmentTrajectory(entry){
  if($('record-dialog').open)$('record-dialog').close();
  $('dialog-trajectory-section').hidden=false;
  $('document-trajectory').hidden = true;
  $('document-permalink').hidden = true;
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
    ['Itens do empenho',entry.itemsChecked?'Consulta concluída':'Aguardando consulta'],
    ['Documentos relacionados · CGU',Array.isArray(doc?.relatedIds)?'Consulta realizada · '+fmtCount(doc.relatedIds.length)+' identidade(s) compatíveis':'Consulta direta ainda pendente']
  ];
  for(const [label,value] of entries)appendDetailField(fields,label,value);
  appendDetailField(fields,'Descrição / observação da nota de empenho',
    doc?.description||'Texto não disponibilizado ou não publicável na fonte consultada',
    {long:true});
  appendCommitmentChronologyFields(fields,doc,entry.items);
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
    'Vínculos de liquidação: '+fmtCount(entry.liquidations.length)+' documento(s), '+(entry.liquidations.length?fmtMoney(entry.liquidationCents):'não identificado')+
    (entry.liquidationUnknown?' · '+fmtCount(entry.liquidationUnknown)+' sem valor por NE':'')+
    '. Vínculos de pagamento: '+fmtCount(entry.payments.length)+' documento(s), '+(entry.payments.length?fmtMoney(entry.paymentCents):'não identificado')+
    (entry.paymentUnknown?' · '+fmtCount(entry.paymentUnknown)+' sem valor por NE':'')+
    '. Pendências de consulta: '+(entry.pendingLiquidations||entry.pendingPayments?'sim':'não identificado nos documentos vinculados carregados')+'.';
  showContractAssociations(doc,{entry});
  showDialogFromTop($('document-dialog'));
}
async function initTrajectories(){
  $('trajectory-search').addEventListener('input',()=>{
    trajectoryPage=0;renderCommitmentTrajectories();
  });
  $('trajectory-catalog-kind').addEventListener('change',()=>renderRelationshipCatalog($('trajectory-search').value,integratedIndex()));
  $('trajectory-evidence').addEventListener('change',()=>{trajectoryPage=0;renderCommitmentTrajectories();});
  $('trajectory-prev').addEventListener('click',()=>{trajectoryPage--;renderCommitmentTrajectories();});
  $('trajectory-next').addEventListener('click',()=>{trajectoryPage++;renderCommitmentTrajectories();});
  $('trajectory-search').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) loadTrajectoryView();
  });
  $('trajectory-load').addEventListener('click',loadTrajectoryView);
  $('trajectory-full').addEventListener('click',async()=>{
    const button=$('trajectory-full');if(button.disabled)return;button.disabled=true;
    try{await loadAllTrajectoryMonths();}catch{$('trajectory-status').textContent='Histórico parcial; uma ou mais competências indisponíveis.';}finally{button.disabled=trajectoryReady;}
  });
  $('document-trajectory').addEventListener('click',()=>{
    $('trajectory-search').value = $('dialog-title').textContent;
    $('trajectory-evidence').value='all';trajectoryPage=0;
    $('document-dialog').close();
    navigateTo('trajectory-section');
    $('trajectory-search').focus();
    if (trajectoryReady) renderCommitmentTrajectories();
    else loadTrajectoryView();
  });
}
async function loadTrajectoryView(){
    if (!state.manifest || $('trajectory-load').disabled || trajectoryReady) return;
    $('trajectory-load').disabled=true;
    try{
      const id=$('trajectory-search').value.trim().toUpperCase();
      if(/^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/.test(id)&&await loadLinkedCompetencies(id)){
        renderCommitmentTrajectories();$('trajectory-status').textContent='Consulta direcionada por índice · '+fmtCount(cache.size)+' competências carregadas. Use Consultar histórico completo para ampliar.';
      }else await loadAllTrajectoryMonths();
    }
    catch{$('trajectory-status').textContent='Não foi possível reconstruir as trajetórias. Verifique a disponibilidade dos JSONs mensais.';}
    finally{
      $('trajectory-load').hidden=trajectoryReady;
      $('trajectory-load').disabled=false;
    }
}

async function loadMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    !state.manifest.months.includes(month)) throw Error('Competência não disponível');
  state.loadingMonth = true;
  setPeriodBusy(true);
  $('export-button').disabled = true;
  status('Carregando documentos da competência…');
  try {
    state.data = await fetchMonth(month);
    await loadObservationOwners([state.data]);
    state.month = month;
    state.historyYear = null;
    state.page = 0;
    selectPeriod();
    updateScope();
    renderAll();
    if(procurementData)renderContracts();
    if(noticesData)renderNotices();
  } finally {
    state.loadingMonth = false;
    setPeriodBusy(false);
    if (state.data) $('export-button').disabled = !filteredDocuments().length;
  }
}
function updateScope() {
  const months = state.historyYear ? availableMonths(state.historyYear) : [];
  const loaded = months.filter(month => cache.has(month)).length;
  const scope = state.historyYear === 'all' ? 'Todos os anos' : state.historyYear;
  $('scope-status').textContent = scope
    ? scope + ' · ' + fmtCount(loaded) + ' de ' + fmtCount(months.length) + ' meses publicados carregados' +
      (state.loadingHistory ? ' · Carregando…' : loaded < months.length ? ' · Alguns meses indisponíveis' : '')
    : '';
  $('scope-status').hidden = !scope;
  $('coverage-chip').hidden = Boolean(scope);
  $('updated').hidden = Boolean(scope);
  $('current-day-note').hidden = Boolean(scope) || state.month !==
    new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date());
  $('history-retry').hidden = !scope || state.loadingHistory || loaded === months.length;
}
async function searchHistory(year) {
  if (state.loadingHistory || state.loadingMonth || !state.data) return;
  state.historyYear = year;
  state.loadingHistory = true;
  setPeriodBusy(true);
  $('day-filter').replaceChildren(new Option('Todos', 'all'));
  state.day = 'all';
  selectPeriod();
  status('');
  updateScope();
  refreshFilters();
  try {
    for (const month of availableMonths(year).reverse()) {
      if (cache.has(month)) continue;
      try { await fetchMonth(month); } catch { /* A nova tentativa aproveita os meses carregados. */ }
      updateScope();
    }
    await loadObservationOwners(availableMonths(year).map(m=>cache.get(m)).filter(Boolean));
  } finally {
    state.loadingHistory = false;
    setPeriodBusy(false);
    updateScope();
    refreshFilters();
    if(noticesData)renderNotices();
    if(procurementData)renderContracts();
    if(atasData)renderAtas();
  }
}
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function exportCsv() {
  const rows = filteredDocuments();
  const data = ['documento,data_listagem_cgu,data_referencia_documental,data_primeira_inclusao_item,fase,valor_documental_centavos,valor_reconsulta_centavos,favorecido,processo'];
  for (const {doc:row, data:monthData,listingDate,observation} of rows) {
    const chronology=row.phase===1?commitmentChronologyEvidence(row,monthData.itemsByDocument?.[row.id],loadedCommitmentObservations(row.id)):null;
    data.push([row.id,listingDate,row.date,chronology?.status==='reconciled'?chronology.originalDate:'',phaseNames[row.phase],
      row.cents === null ? '' : row.cents,observation?.cents??'',
      beneficiaryLabel(row,monthData), row.process || ''].map(csvCell).join(','));
  }
  const blob = new Blob(['\uFEFF' + data.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = 'observatorio-ug-158459-' + (state.historyYear === 'all' ? 'historico' : state.historyYear ?? state.month) + '.csv';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function initEvents() {
  $('budget-dimension').replaceChildren(...Object.entries(BUDGET_DIMENSIONS).map(([key,label])=>new Option(label,key)));
  $('budget-dimension').value=state.budgetDimension;
  $('budget-dimension').addEventListener('change',e=>{state.budgetDimension=e.target.value;state.budgetOptionSearch='';$('budget-option-search').value='';if(state.data)renderTable();});
  $('budget-option-search').addEventListener('input',e=>{state.budgetOptionSearch=e.target.value;if(state.data)renderTable();});
  $('budget-clear').addEventListener('click',()=>{state.budgetSelections={};state.budgetOptionSearch='';$('budget-option-search').value='';if(state.data)refreshFilters();});
  $('budget-all-history').addEventListener('click',()=>searchHistory('all'));
  $('siop-help').addEventListener('click',()=>showDialogFromTop($('siop-dialog')));
  $('close-siop-dialog').addEventListener('click',()=>$('siop-dialog').close());
  $('budget-metric').addEventListener('change',e=>{state.budgetMetric=e.target.value;if(state.data)renderTable();});
  $('siop-kind').replaceChildren(...Object.entries(SIOP_DIMENSIONS).filter(([key])=>!['pi','subtitle'].includes(key)).map(([key,label])=>new Option(label,key)));
  $('siop-kind').value='action';
  $('siop-kind').addEventListener('change',renderSiopReference);$('siop-year').addEventListener('change',renderSiopReference);
  $('siop-search').addEventListener('input',renderSiopReference);
  const changePeriod = async month => {
    try { await loadMonth(month); }
    catch {
      selectPeriod();
      status('Não foi possível carregar o mês escolhido. A consulta anterior continua disponível.', 'warning');
    }
  };
  $('year-select').addEventListener('change', event => {
    searchHistory(event.target.value);
  });
  $('month-select').addEventListener('change', event => {
    if (event.target.value === 'all') searchHistory($('year-select').value);
    else changePeriod(event.target.value);
  });
  $('history-retry').addEventListener('click', () => searchHistory(state.historyYear));
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    const route = link.hash.slice(1);
    if (!Object.hasOwn(views, route)) continue;
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      navigateTo(route);
    });
  }
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    $('conteudo').focus();
  });
  window.addEventListener('hashchange', () => showView(initialRoute(), true));
  showView(initialRoute());
  $('retry-manifest').addEventListener('click', init);
  $('search-doc').addEventListener('input', event => {
    state.search = event.target.value.trim().toLowerCase(); refreshFilters();
  });
  for (const button of document.querySelectorAll('[data-document-phase]')) {
    button.addEventListener('click', () => {
      state.phase = button.dataset.documentPhase;
      refreshFilters();
    });
  }
  $('day-filter').addEventListener('change', event => {
    state.day = event.target.value; refreshFilters();
  });
  $('clear-filters').addEventListener('click', () => {
    state.search = ''; state.phase = 'all'; state.day = 'all'; state.budgetSelections={};state.budgetOptionSearch='';$('budget-option-search').value='';
    $('search-doc').value = ''; $('day-filter').value = 'all';
    refreshFilters();
  });
  for (const card of document.querySelectorAll('.stat-card')) {
    card.addEventListener('click', () => {
      if (state.loadingHistory || state.loadingMonth) return;
      const active = !state.historyYear && state.phase === card.dataset.phase;
      const returnToMonth = Boolean(state.historyYear);
      state.historyYear = null;
      state.phase = active ? 'all' : card.dataset.phase;
      if (returnToMonth) {
        selectPeriod();
        renderDays();
        setPeriodBusy(false);
      }
      updateScope();
      refreshFilters();
      navigateTo('despesas');
    });
  }
  $('export-button').addEventListener('click', exportCsv);
  $('close-dialog').addEventListener('click', () => $('document-dialog').close());
  $('close-record-dialog').addEventListener('click', () => $('record-dialog').close());
  const applyTheme = theme => {
    document.documentElement.dataset.theme = theme;
    $('theme-toggle').setAttribute('aria-pressed', String(theme === 'dark'));
    $('theme-icon').textContent = theme === 'dark' ? '☀' : '☾';
  };
  applyTheme(localStorage.getItem('observatorio-tema') === 'dark' ? 'dark' : 'light');
  $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('observatorio-tema', next);
  });
}
async function init() {
  $('empty-state').hidden = true;
  $('retry-manifest').hidden = true;
  status('Carregando o acervo público da CGU…');
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
    const months = [...manifest.months].sort();
    const years = [...new Set(months.map(month => month.slice(0, 4)))].reverse();
    $('year-select').replaceChildren(new Option('Todos', 'all'), ...years.map(year => new Option(year, year)));
    const latestMonth = months.at(-1);
    const params = new URLSearchParams(location.search);
    const linkedMonth = params.get('competencia');
    const documentId = params.get('documento');
    const hasLink = manifest.months.includes(linkedMonth) &&
      /^158459\d{5}20\d{2}[A-Z]{2}\d{6}$/.test(documentId || '');
    if (hasLink) {
      try { await loadMonth(linkedMonth); }
      catch {
        await loadMonth(latestMonth);
        status('A competência da ficha está indisponível. A consulta recente está disponível abaixo.', 'warning');
      }
    } else await loadMonth(latestMonth);
    $('dashboard').hidden = false;
    if (hasLink && state.month === linkedMonth) {
      const doc = state.data.documents.find(entry => entry.id === documentId);
      if (doc) {
        showView('despesas');
        $('search-doc').focus({preventScroll:true});
        showDocument(doc, state.data);
      } else status('Documento não localizado na competência indicada pelo link.', 'warning');
    }
  } catch {
    $('dashboard').hidden = true; $('empty-state').hidden = false;
    $('retry-manifest').hidden = false;
    $('empty-title').textContent = 'Dados indisponíveis';
    $('empty-description').textContent =
      'Não foi possível carregar a base pública. Verifique a publicação do GitHub Pages e o status da coleta.';
    status('Falha ao carregar o acervo público. Nenhum total foi presumido.', 'warning');
  }
}

function filteredContracts(){
  if(!procurementData)return [];
  if(!dateStatus('contract',contractsState))return [];
  return procurementData.contracts.filter(contract=>{
    if(!isFormalContract(contract))return false;
    if(!filterStructuredContract(contract,{...contractsState,today:todayBrazil()}))return false;
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
    return matchesCatalogSearch(contractsState.query,fields);
  }).sort((a,b)=>compareCatalogDates(a,b,{sort:contractsState.sort,field:contractsState.dateKind}));
}
function renderContracts(){
  if(!procurementData)return;
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
  enrichPagination('contract-prev','contract-next',contractsState,totalPages,renderContracts);
  countFilterStatus('contract',contractsState,all.length,formal,[contractsState.source!=='all'?'Fonte':'',contractsState.scope!=='all'?'Publicador':'',contractsState.attribution!=='all'?'Escopo':'',contractsState.minCents!==null||contractsState.maxCents!==null?'Valor':'']);
  const tbody=$('contract-rows');
  tbody.replaceChildren();
  if(!rows.length){
    const row=element('tr'),cell=element('td','',
      'Nenhum contrato disponível para os filtros e períodos já consultados.');
    cell.colSpan=9;row.append(cell);tbody.append(row);return;
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
    row.append(source,proof,idcell,purchaseCell,supplier,process,amount,dateCell(contract),details);
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
  renderIfcAdhesions();
  $('contract-coverage').textContent=labels.join(' · ')+
    '. A seção abaixo mostra apenas contratos formais. Por padrão, destaca somente '+
    'os que possuem evidências de Araquari. Processos e publicações podem ser incompletos.';
}
function renderIfcAdhesions(){
 const root=$('ifc-adhesions-content');if(!procurementData)return;
 const all=(procurementData.contracts||[]).filter(isAraquariAdhesion);
 const rows=dateStatus('adhesion',adhesionState)?all.filter(c=>filterStructuredContract(c,{...adhesionState,today:todayBrazil()})&&
  (adhesionState.kind==='all'||(adhesionState.kind==='formal')===isFormalContract(c))&&matchesCatalogSearch(adhesionState.query,[c.number,c.pncpId,c.ataControl,c.process,c.object,c.supplierName,c.supplierCnpj,c.supplierCpfMasked])).sort((a,b)=>compareCatalogDates(a,b,{sort:adhesionState.sort,field:adhesionState.dateKind})): [];
 root.replaceChildren();
 countFilterStatus('adhesion',adhesionState,rows.length,all.length,[adhesionState.kind!=='all'?'Espécie':'']);
 const pages=compactPagination($('adhesion-pages'),adhesionState,rows.length,20,renderIfcAdhesions);
 $('adhesion-page-info').textContent='Página '+(adhesionState.page+1)+' de '+pages+' · '+fmtCount(rows.length)+' adesões';
 if(!rows.length){root.append(element('p','helper','Nenhuma adesão identificada para os filtros no acervo consultado.'));return;}
 const host=element('div','adhesion-cards');
 for(const c of rows.slice(adhesionState.page*20,(adhesionState.page+1)*20)){
  const card=element('article','relation-item adhesion-card');
  card.append(element('strong','',c.number||c.pncpId),element('span','small-muted',c.kind||'Instrumento PNCP'),element('span','',contractSupplier(c)),element('span','small-muted','Assinatura: '+(c.signed?localDate(c.signed):'—')+' · Fim: '+(c.ends?localDate(c.ends):'—')),
   element('span','validity-tag validity-'+validityStatus(c,todayBrazil()),validityLabels[validityStatus(c,todayBrazil())]));
  if(c.ataControl)card.append(element('span','small-muted','Ata de origem: '+c.ataControl));
  card.append(relationButton('Ver ficha e trajetória',()=>showCatalogDetail(c,'instrument')));
  const url=publicPncpUrl(c);if(url){const link=element('a','inline-link','Registro oficial PNCP');link.href=url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
  host.append(card);
 }
 root.append(host);
}
function renderAtas(){
 if(!atasData){$('ata-count').textContent='Catálogo de atas indisponível';return;}
 const notices=new Map((noticesData?.notices||[]).map(n=>[n.pncpId,n]));
 const rows=dateStatus('ata',ataState)?atasData.atas.filter(ata=>{
  const n=notices.get(ata.procurementId),detail=arpDetailsById?.get(ata.id);
  if(!filterStructuredAta(ata,detail,{...ataState,today:todayBrazil()}))return false;
  if(ataState.scope!=='all'){const ev=n?noticeEvidence(n):{level:'unverified'};if(ataState.scope==='confirmed'?ev.level!=='confirmed':ev.level==='unverified')return false;}
  return matchesCatalogSearch(ataState.query,[ata.number,ata.id,ataControlFor(ata),n?.number,n?.process,n?.object,...(detail?.compras?.items||[]).map(i=>i.supplierCnpj||i.supplierCpfMasked)]);
 }).sort((a,b)=>compareCatalogDates(a,b,{sort:ataState.sort,field:ataState.dateKind})): [];
 const pages=compactPagination($('ata-pages'),ataState,rows.length,20,renderAtas);
 $('ata-count').textContent=fmtCount(rows.length)+' de '+fmtCount(atasData.atas.length)+' atas IFC';
 $('ata-page-info').textContent='Página '+(ataState.page+1)+' de '+pages;
 countFilterStatus('ata',ataState,rows.length,atasData.atas.length,[ataState.scope!=='all'?'Escopo':'',ataState.items!=='all'?'Itens':'',ataState.files!=='all'?'Documentos':'',ataState.adhesion!=='all'?'Adesão':'']);
 const tbody=$('ata-rows');tbody.replaceChildren();
 if(!rows.length){const tr=element('tr'),td=element('td','','Nenhuma ata corresponde aos filtros no acervo consultado.');td.colSpan=7;tr.append(td);tbody.append(tr);return;}
 for(const ata of rows.slice(ataState.page*20,(ataState.page+1)*20)){
  const tr=element('tr'),n=notices.get(ata.procurementId),detail=arpDetailsById?.get(ata.id),id=element('td'),origin=element('td'),status=validityStatus(ata,todayBrazil()),st=element('td'),coverage=element('td'),actions=element('td');
  id.append(relationButton('Ata '+(ata.number||ata.sequence),()=>showCatalogDetail(ata,'ata')),element('span','small-muted',ataControlFor(ata)||ata.id));
  if(n)origin.append(relationButton((MODALITIES[n.modality]||'Licitação')+' · '+(n.number||n.pncpId),()=>showCatalogDetail(n,'notice')));
  else origin.append(element('span','small-muted',ata.procurementId));
  st.append(element('span','validity-tag validity-'+status,validityLabels[status]));
  coverage.append(element('span','small-muted',detail?.compras?fmtCount(detail.compras.items.length)+' registros de item/fornecedor':'Itens pendentes'),element('span','small-muted',Array.isArray(detail?.files)?fmtCount(detail.files.length)+' documento(s)':'Arquivos ainda não consultados'));
  actions.append(relationButton('Ver detalhes',()=>showCatalogDetail(ata,'ata')));
  const url=publicAtaUrl(ata);if(url){const link=element('a','inline-link','PNCP ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}
  tr.append(id,origin,element('td','',ata.signed?localDate(ata.signed):'—'),dateCell(ata),st,coverage,actions);tbody.append(tr);
 }
}
function initAtaAdhesionFilters(){
 bindDateFilters('ata',ataState,renderAtas);bindDateFilters('adhesion',adhesionState,renderIfcAdhesions);
 for(const [prefix,s,render,keys] of [['ata',ataState,renderAtas,['scope','items','files','adhesion']],['adhesion',adhesionState,renderIfcAdhesions,['kind']]]){
  $(prefix+'-search').addEventListener('input',e=>{s.query=e.target.value;s.page=0;render();});
  for(const key of keys)$(prefix+'-'+key).addEventListener('change',e=>{s[key]=e.target.value;s.page=0;render();});
  $(prefix+'-reset').addEventListener('click',()=>{s.query='';s.page=0;$(prefix+'-search').value='';for(const key of keys){s[key]='all';$(prefix+'-'+key).value='all';}resetDates(prefix,s,'signed');render();});
 }
}
async function initProcurement(){
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
  bindDateFilters('contract',contractsState,renderContracts);
  $('clear-contract-filters').addEventListener('click',()=>{
    contractsState.query='';contractsState.source='all';contractsState.scope='all';
    contractsState.attribution='all';contractsState.minCents=null;
    contractsState.maxCents=null;contractsState.activeOn='';
    contractsState.page=0;
    resetDates('contract',contractsState,'signed');
    for(const id of ['contract-min-value','contract-max-value']){$(id).value='';$(id).setCustomValidity('');}
    $('contract-search').value='';
    $('contract-source').value='all';$('contract-scope').value='all';
    $('contract-attribution').value='all';
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
    $('ifc-adhesions-content').textContent='Catálogo de instrumentos indisponível.';
    renderContracts();
  }
}


function publicAtaUrl(ata){
 const m=/^(\d{14})-1-(\d{6})\/(20\d{2})$/.exec(ata?.procurementId||'');
 return m&&Number.isSafeInteger(ata.sequence)&&ata.sequence>0&&ata.sequence<=999999&&ata.id===ata.procurementId+':ata:'+ata.sequence?
  'https://pncp.gov.br/app/atas/'+m[1]+'/'+m[3]+'/'+Number(m[2])+'/'+ata.sequence:null;
}
function publicNoticeUrl(notice) {
  const id=/^(\d{14})-1-(\d{6})\/(20\d{2})$/.exec(notice?.pncpId||'');
  return id?'https://pncp.gov.br/app/editais/'+id[1]+'/'+id[3]+'/'+Number(id[2]):null;
}
function noticeEvidence(notice){
 const ctx=evidenceContext();
 if(!ctx.notices.has(notice))ctx.notices.set(notice,assessNoticeAttribution(notice,procurementData?.contracts||[],ctx.docs));
 return ctx.notices.get(notice);
}
function filteredNotices() {
  if(!dateStatus('notices',noticesState))return [];
  const query = searchText(noticesState.query);
  const ataMatches = new Set(query ? (atasData?.atas || []).filter(ata =>
    [ata.id, ata.number].some(value => searchText(value).includes(query)))
    .map(ata => ata.procurementId) : []);
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
    return !query || ataMatches.has(item.pncpId) || matchesCatalogSearch(query,values);
  }).sort((a,b)=>compareCatalogDates(a,b,{sort:noticesState.sort,field:noticesState.dateKind}));
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
  fmtCount(audit.counts.verified)+' · coincidências abreviadas (indícios): '+fmtCount(audit.counts.indication_only||0)+' · não localizadas no histórico publicado: '+
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
  const status=row.status==='verified'?'NE integral conferida com CGU':
   row.status==='indication_only'?'NE abreviada coincidente; vínculo não confirmado':
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
let procurementAuditSignature=null;
function renderNotices() {
  if(!noticesData)return;
  const signature=[noticesData,evidenceContext(),state.manifest?.months?.length];
  if(!procurementAuditSignature||signature.some((v,i)=>v!==procurementAuditSignature[i])){
   renderProcurementEvidenceCoverage();renderProcurementEvidenceAudit();procurementAuditSignature=signature;
  }
  const all=filteredNotices();
  const pages=Math.max(1,Math.ceil(all.length/20));
  noticesState.page=Math.max(0,Math.min(pages-1,noticesState.page));
  $('notices-count').textContent=fmtCount(all.length)+' de '+
    fmtCount(noticesData.notices.length)+' publicações IFC';
  $('notices-page-info').textContent='Página '+(noticesState.page+1)+' de '+pages;
  $('notices-prev').disabled=noticesState.page===0;
  $('notices-next').disabled=noticesState.page>=pages-1;
  enrichPagination('notices-prev','notices-next',noticesState,pages,renderNotices);
  countFilterStatus('notices',noticesState,all.length,noticesData.notices.length,[noticesState.attribution!=='all'?'Escopo':'',noticesState.modality!=='all'?'Modalidade':'',noticesState.srp!=='all'?'SRP':'',noticesState.minCents!==null||noticesState.maxCents!==null?'Valor':'']);
  const tbody=$('notices-rows');
  tbody.replaceChildren();
  if(!all.length){
    const row=element('tr'),cell=element('td','',
      'Nenhuma publicação correspondente aos filtros ou competências já consultadas.');
    cell.colSpan=8;row.append(cell);tbody.append(row);
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
    const noticeAtas=(atasData?.atas||[]).filter(a=>a.procurementId===notice.pncpId);
    const ataCount=noticeAtas.length;
    const ataChecked=(atasData?.checks||[]).some(c=>c.procurementId===notice.pncpId);
    const related=element('td','');
    const financial=procurementFinancialEvidence(notice,procurementData?.contracts||[],loadedCguDocuments());
    if(financial.verifiedCommitments){
      const evidence=element('span','small-muted',fmtCount(financial.verifiedCommitments)+' NE(s) Araquari conferida(s) com CGU');
      evidence.title='NE integral da UG 158459 identificada em documento CGU e vinculada ao instrumento pelo identificador completo. Nao equivale a quantidade adquirida por item.';
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
    if(ataCount)related.append(element('span','small-muted',fmtCount(ataCount)+' ata(s) PNCP'));
    else if(notice.srp===true)related.append(element('span','small-muted',ataChecked?'Nenhuma ata retornada na última consulta':'Atas ainda não consultadas'));
    if(linked.formal.length) {
      const button=element('button','relation-link',
        linked.formal.length+' contrato(s) formal(is)');
      button.type='button';
      button.title='Vínculo entre a contratação e os termos de contrato pelo ID PNCP. Não equivale à nota de empenho da UG 158459.';
      button.addEventListener('click',()=>{
        resetDates('contract',contractsState,'signed');
        contractsState.minCents=null;contractsState.maxCents=null;
        for(const id of ['contract-min-value','contract-max-value']){$(id).value='';$(id).setCustomValidity('');}
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
        navigateTo('procurement-section');
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
    row.append(modality,docCell,related,process,status,value,dateCell(notice,{notice:true}),details);
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
  bindDateFilters('notices',noticesState,renderNotices);
  $('notices-reset').addEventListener('click',()=>{
    noticesState.query='';noticesState.modality='all';noticesState.attribution='all';
    noticesState.srp='all';noticesState.minCents=null;noticesState.maxCents=null;
    noticesState.page=0;
    $('notices-search').value='';selector.value='all';
    $('notices-srp').value='all';$('notices-min-value').value='';$('notices-max-value').value='';
    $('notices-attribution').value='all';
    resetDates('notices',noticesState,'published');
    $('notices-min-value').setCustomValidity('');$('notices-max-value').setCustomValidity('');
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
    const response=await fetch('./data/procurement/ata-participants.json',{cache:'no-store'});
    if(response.ok){const parsed=await response.json();if(Array.isArray(parsed.details))arpDetailsById=new Map(parsed.details.map(d=>[d.ataId,d]));if(Array.isArray(parsed.checks))arpParticipationById=new Map(parsed.checks.map(d=>[d.ataId,d]));}
  }catch{arpDetailsById=null;}
  try{
    const response=await fetch('./data/procurement/notices.json',{cache:'no-store'});
    if(!response.ok)throw Error('Catálogo ainda não publicado');
    const data=await response.json();
    if(data?.schema_version!==1||data.publicationUasg!=='158125'||
      !Array.isArray(data.notices)||!Array.isArray(data.coverage))
      throw Error('Dados PNCP incompatíveis');
    noticesData=data;
    renderNoticesCoverage();
    renderNotices();renderAtas();if(tenderItemsState.data)renderTenderItems();
  }catch{
    noticesData={notices:[],coverage:[]};
    $('notices-coverage').className='notice warning';
    $('notices-coverage').textContent=
      'Aguardando a primeira coleta de licitações e contratações diretas. Nenhuma contratação foi presumida.';
    renderNotices();renderAtas();if(tenderItemsState.data)renderTenderItems();
  }
}

const tenderItemsState={data:null,query:'',procedure:'all',page:0,loading:false,result:'all',srp:'all',modality:'all',...dateDefaults('published')};
function renderTenderItems(){
 const d=tenderItemsState.data;if(!d)return;
 const all=d.procedures.flatMap(p=>p.items.map(item=>({...item,checkedAt:p.checkedAt})));
 const q=tenderItemsState.query,notices=new Map((noticesData?.notices||[]).map(n=>[n.pncpId,n]));
 const filtered=dateStatus('tender-items',tenderItemsState)?all.filter(item=>{
  const notice=notices.get(item.pncpId);
  return (tenderItemsState.procedure==='all'||item.pncpId===tenderItemsState.procedure)&&filterStructuredTenderItem(item,notice,tenderItemsState)&&matchesCatalogSearch(q,[item.description,item.pncpId,item.number,notice?.object,notice?.process,...(item.results||[]).flatMap(r=>[r.supplierCnpj,r.supplierCpfMasked])]);
 }).sort((a,b)=>(notices.get(b.pncpId)?.published||'').localeCompare(notices.get(a.pncpId)?.published||'')||b.pncpId.localeCompare(a.pncpId)||a.number-b.number):[];
 const pages=Math.max(1,Math.ceil(filtered.length/25));
 tenderItemsState.page=Math.max(0,Math.min(tenderItemsState.page,pages-1));
 $('tender-items-page-info').textContent='Página '+(tenderItemsState.page+1)+' de '+pages+' · '+fmtCount(filtered.length)+' itens';
 $('tender-items-prev').disabled=tenderItemsState.page===0;
 $('tender-items-next').disabled=tenderItemsState.page>=pages-1;
 enrichPagination('tender-items-prev','tender-items-next',tenderItemsState,pages,renderTenderItems);
 countFilterStatus('tender-items',tenderItemsState,filtered.length,all.length,[tenderItemsState.procedure!=='all'?'Licitação':'',tenderItemsState.modality!=='all'?'Modalidade':'',tenderItemsState.result!=='all'?'Resultados':'',tenderItemsState.srp!=='all'?'SRP':'']);
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
   const button=element('button','details-button',fmtCount(item.results.length)+' resultado(s)');button.type='button';
   button.addEventListener('click',()=>{
    $('item-result-title').textContent='Item '+item.number+' · '+item.description;
    const details=$('item-result-content');details.replaceChildren();
   const dec=v=>v===undefined?'Não informado':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:8}).format(Number(v));
   for(const r of item.results){
    const vendor=r.supplierCnpj?'CNPJ '+r.supplierCnpj:r.supplierCpfMasked?'CPF '+r.supplierCpfMasked:r.supplierType==='PE'?'Fornecedor estrangeiro':'Fornecedor não identificado publicamente';
    const description=[vendor,r.status===2?'Cancelado':'Informado','Data: '+localDate(r.date),'Quantidade homologada: '+dec(r.quantity),'Unitário homologado: R$ '+dec(r.unitPrice),r.total!==undefined?'Total informado: R$ '+dec(r.total):null,r.rank?'Classificação SRP: '+r.rank:null,r.reserve===2?'Remanescente':r.reserve===3?'Cadastro de reserva':null,r.cancelledAt?'Cancelado em '+localDate(r.cancelledAt):null].filter(Boolean).join(' · ');
    details.append(element('div','relation-item',description));
   }
   showDialogFromTop($('item-result-dialog'));});resultCell.append(button);
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
  if([...sel.options].some(o=>o.value===tenderItemsState.procedure))sel.value=tenderItemsState.procedure;else tenderItemsState.procedure='all';tenderItemsState.page=0;
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
 bindDateFilters('tender-items',tenderItemsState,renderTenderItems);
 for(const [id,key] of [['result','result'],['srp','srp'],['modality','modality']])$('tender-items-'+id).addEventListener('change',e=>{tenderItemsState[key]=e.target.value;tenderItemsState.page=0;renderTenderItems();});
 for(const [key,label] of Object.entries(MODALITIES))$('tender-items-modality').append(new Option(label,key));
 $('tender-items-reset').addEventListener('click',()=>{Object.assign(tenderItemsState,{query:'',procedure:'all',result:'all',srp:'all',modality:'all',page:0});$('tender-items-search').value='';for(const id of ['procedure','result','srp','modality'])$('tender-items-'+id).value='all';resetDates('tender-items',tenderItemsState,'published');renderTenderItems();});
 $('close-item-result').addEventListener('click',()=>$('item-result-dialog').close());
 $('tender-items-load').addEventListener('click',loadTenderItems);
 $('tender-items-search').addEventListener('input',e=>{tenderItemsState.query=e.target.value.trim().toLowerCase();tenderItemsState.page=0;renderTenderItems();});
 $('tender-items-procedure').addEventListener('change',e=>{tenderItemsState.procedure=e.target.value;tenderItemsState.page=0;renderTenderItems();});
 $('tender-items-prev').addEventListener('click',()=>{tenderItemsState.page--;renderTenderItems();});
 $('tender-items-next').addEventListener('click',()=>{tenderItemsState.page++;renderTenderItems();});
}

initAtaAdhesionFilters();
initTenderItems();
initEvents();
init();
loadSiopReference();
initTrajectories();
async function loadCguContractEvidence(){
 try{const response=await fetch('./data/procurement/cgu-contract-links.json',{cache:'no-store'});if(response.ok){const data=await response.json();if(data.schema_version===1&&data.unit==='158459'&&Array.isArray(data.contracts)){cguContractEvidence=data.contracts; if(trajectoryReady||$('trajectory-search').value)renderCommitmentTrajectories();}}}catch{/* A fonte complementar nao impede a navegacao. */}
}
loadCguContractEvidence();
initProcurement().then(()=>{if(noticesData)renderNotices();if(atasData)renderAtas();if(state.data)renderTable();if(trajectoryReady)renderCommitmentTrajectories();});
initNotices().then(()=>{if(trajectoryReady)renderCommitmentTrajectories();});

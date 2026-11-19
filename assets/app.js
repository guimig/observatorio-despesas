/** Visualização local de JSONs públicos. Não consulta APIs autenticadas. */
const $ = id => document.getElementById(id);
const fmtMoney = cents => Number.isSafeInteger(cents)
  ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
  : 'Indisponível';
const fmtCount = n => new Intl.NumberFormat('pt-BR').format(n);
const phaseNames = { 1: 'Empenho', 2: 'Liquidação', 3: 'Pagamento' };
const pageSize = 25;
const cache = new Map();
const state = { manifest: null, month: null, data: null, search: '', phase: 'all', day: 'all', page: 0 };

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
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
function expectedDaysInMonth(month, now = new Date()) {
  const monthParts = month.split('-').map(Number);
  const max = new Date(Date.UTC(monthParts[0], monthParts[1], 0)).getUTCDate();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(part => [part.type, part.value]));
  const todayMonth = parts.year + '-' + parts.month;
  if (month > todayMonth) return 0;
  if (month === todayMonth) return Math.max(0, Math.min(max, Number(parts.day) - 1));
  return max;
}
function validDayCount() {
  const byDay = new Map();
  for (const coverage of state.data.coverage) {
    if (!byDay.has(coverage.date)) byDay.set(coverage.date, new Map());
    byDay.get(coverage.date).set(coverage.phase, coverage);
  }
  return [...byDay.values()].filter(phases =>
    [1, 2, 3].every(phase => phases.get(phase)?.complete && phases.get(phase)?.invalid === 0)).length;
}
function summarize(phase) {
  const coverage = state.data.coverage.filter(entry => entry.phase === phase);
  const documents = state.data.documents.filter(doc => doc.phase === phase);
  const complete = coverage.length > 0 && coverage.every(entry => entry.complete);
  const invalid = coverage.reduce((n, x) => n + x.invalid, 0);
  const count = coverage.reduce((n, x) => n + x.count, 0);
  const sum = complete && !invalid && documents.every(doc => Number.isSafeInteger(doc.cents))
    ? documents.reduce((n, doc) => n + doc.cents, 0) : null;
  return { count, sum, complete, invalid };
}
function renderStats() {
  const stats = [1, 2, 3].map(summarize);
  stats.forEach((stat, index) => {
    const phase = index + 1;
    $('amount-' + phase).textContent = fmtMoney(stat.sum);
    const prefix = stat.complete ? '' : 'Pelo menos ';
    $('count-' + phase).textContent = prefix + fmtCount(stat.count) +
      ' documento(s) nas datas consultadas' +
      (stat.invalid ? ' · ' + stat.invalid + ' valor(es) indisponível(is)' : '');
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
  const coverages = state.data.coverage;
  const partial = coverages.filter(c => !c.complete);
  const invalid = coverages.reduce((n, c) => n + c.invalid, 0);
  const expected = expectedDaysInMonth(state.month);
  const validDays = validDayCount();
  const missing = Math.max(0, expected - validDays);
  $('days-covered').textContent = fmtCount(validDays) + '/' + fmtCount(expected);
  $('incomplete-count').textContent = fmtCount(partial.length);
  $('invalid-count').textContent = fmtCount(invalid);
  $('relations-count').textContent = fmtCount(state.data.relations.length);
  const hasIssues = partial.length > 0 || invalid > 0 || missing > 0;
  $('coverage-chip').textContent = hasIssues
    ? 'Cobertura parcial da competência' : 'Competência integralmente consultada';
  status(hasIssues
    ? 'Competência com cobertura parcial: ' + validDays + ' de ' + expected +
      ' dias encerrados com três fases completas. ' + missing +
      ' dia(s) ainda precisam de cobertura válida; totais exibidos se referem somente às datas já consultadas.'
    : 'Todos os dias encerrados da competência têm consulta documental completa. Valores não conciliados com sistemas contábeis.',
    hasIssues ? 'warning' : 'success');
}
function formatCnpj(value) {
  return /^\d{14}$/.test(value || '') ? value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : value;
}
function beneficiaryLabel(doc) {
  if (doc.cpfMasked) return 'Pessoa física · CPF ' + doc.cpfMasked;
  if (!doc.partyRef) return 'Não identificado';
  const name = state.data.beneficiaries?.[doc.partyRef] || 'Pessoa jurídica';
  return name + ' · CNPJ ' + formatCnpj(doc.partyRef);
}
function filteredDocuments() {
  return state.data.documents.filter(doc => {
    if (state.phase !== 'all' && String(doc.phase) !== state.phase) return false;
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
function showDocument(doc) {
  $('dialog-title').textContent = doc.id;
  const fields = $('dialog-fields');
  fields.replaceChildren();
  const entries = [
    ['Documento SIAFI', doc.id], ['Fase', phaseNames[doc.phase] || 'Outra'],
    ['Data de emissão', localDate(doc.date)], ['Valor', fmtMoney(doc.cents)],
    ['Unidade gestora', '158459 · IFC Araquari'],
    ['Favorecido', beneficiaryLabel(doc)], ['Processo administrativo', doc.process || 'Não informado'],
    ['Grupo de despesa', doc.nature?.group || 'Não informado'],
    ['Elemento', doc.nature?.element || 'Não informado'],
    ['Programa', doc.nature?.program || 'Não informado'],
    ['Ação orçamentária', doc.nature?.action || 'Não informada'],
    ['Fonte', 'CGU / Portal da Transparência']
  ];
  entries.forEach(([label, value]) => {
    const group = element('div');
    group.append(element('dt', '', label), element('dd', '', value));
    fields.append(group);
  });
  const relations = state.data.relations.filter(relation =>
    relation.from === doc.id || relation.to === doc.id);
  const list = $('dialog-relations');
  list.replaceChildren();
  if (!relations.length) {
    list.append(element('p', 'small-muted', 'Nenhum vínculo documentado neste mês.'));
  } else {
    relations.forEach(relation => {
      const item = element('div', 'relation-item');
      const associated = relation.from === doc.id ? relation.to : relation.from;
      item.append(element('span', 'small-muted',
        relation.from === doc.id ? 'Empenho relacionado' : 'Documento NS relacionado'));
      item.append(element('span', 'doc-code', associated));
      item.append(element('strong', '', 'Valor do vínculo: ' + fmtMoney(relation.cents)));
      list.append(item);
    });
  }
  $('document-dialog').showModal();
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
init();

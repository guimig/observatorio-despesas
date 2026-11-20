/**
 * Planejador de recuperação histórica sem arquivo extra de checkpoint:
 * a cobertura diária validada do JSON mensal é a fonte de verdade.
 */
import { isoDate } from './cgu.mjs';

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;

export function currentDateInBrazil(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric',
    month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

export function previousMonthInBrazil(now = new Date()) {
  const date = currentDateInBrazil(now);
  const [year, month] = date.split('-').map(Number);
  const last = new Date(Date.UTC(year, month - 1, 0));
  return String(last.getUTCFullYear()) + '-' +
    String(last.getUTCMonth() + 1).padStart(2, '0');
}

export function planHistoricalDays({
  month, existing = null, now = new Date(),
  batchDays = 3, startDay = 1, recheck = false
} = {}) {
  if (!MONTH.test(month)) throw Error('Competência histórica inválida');
  if (!Number.isSafeInteger(batchDays) || batchDays < 1 || batchDays > 7) {
    throw Error('Lote histórico deve conter entre 1 e 7 dias');
  }
  if (!Number.isSafeInteger(startDay) || startDay < 1 || startDay > 31) {
    throw Error('Dia inicial inválido');
  }
  if (existing && (existing.month !== month || !Array.isArray(existing.coverage))) {
    throw Error('JSON histórico incompatível');
  }
  const daysInMonth = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const today = currentDateInBrazil(now);
  const done = new Map();
  for (const status of (existing?.coverage || [])) {
    if (!done.has(status.date)) done.set(status.date, new Map());
    done.get(status.date).set(status.phase, status);
  }
  const candidates = [];
  for (let day = startDay; day <= daysInMonth; day++) {
    const value = month + '-' + String(day).padStart(2, '0');
    if (value >= today) break; // Não consultar o dia corrente ou futuro.
    const completed = [1, 2, 3].every(phase => {
      const status = done.get(value)?.get(phase);
      return status?.complete === true && status.invalid === 0;
    });
    if (completed && !recheck) continue;
    const brDate = String(day).padStart(2, '0') + '/' +
      month.slice(5, 7) + '/' + month.slice(0, 4);
    isoDate(brDate);
    candidates.push(brDate);
    if (candidates.length >= batchDays) break;
  }
  return candidates;
}

/** Seleciona a competência mais recente ainda incompleta, retrocedendo até o
 * limite configurado. Não presume que um mês sem arquivo tenha zero despesas. */
export function missingCommitmentYears(months) {
  if (!Array.isArray(months)) throw Error('Acervo inválido');
  const known = new Set(months.flatMap(m => m.documents.filter(d => d.phase === 1).map(d => d.id)));
  const missing = new Set(months.flatMap(m => m.relations.map(r => r.to))
    .filter(id => /^158459\d{5}20\d{2}NE\d{6}$/.test(id) && !known.has(id)));
  return [...new Set([...missing].map(id => id.slice(11, 15)))].sort();
}

export async function chooseHistoricalMonth({
  requestedMonth='',earliestMonth='2026-01',now=new Date(),
  loadExisting=async()=>null, priorityYears=[], prioritize=false
}={}){
  if(requestedMonth){
    if(!MONTH.test(requestedMonth))throw Error('Competência manual inválida');
    return requestedMonth;
  }
  if(!MONTH.test(earliestMonth))throw Error('Início histórico inválido');
  const previous=previousMonthInBrazil(now);
  if(earliestMonth>previous)return null;
  const [year,month]=previous.split('-').map(Number);
  if (prioritize) {
    for (const targetYear of [...new Set(priorityYears)].sort()) {
      if (!/^20\d{2}$/.test(targetYear)) continue;
      for (let monthNumber=12;monthNumber>=1;monthNumber--) {
        const candidate=targetYear+'-'+String(monthNumber).padStart(2,'0');
        if (candidate<earliestMonth || candidate>previous) continue;
        const existing=await loadExisting(candidate);
        if (planHistoricalDays({month:candidate,existing,now,batchDays:1}).length) return candidate;
      }
    }
  }
  for(let cursor=new Date(Date.UTC(year,month-1,1));
    cursor.toISOString().slice(0,7)>=earliestMonth;
    cursor.setUTCMonth(cursor.getUTCMonth()-1)){
    const candidate=cursor.toISOString().slice(0,7);
    const existing=await loadExisting(candidate);
    if(planHistoricalDays({month:candidate,existing,now,batchDays:1}).length)
      return candidate;
  }
  return null;
}

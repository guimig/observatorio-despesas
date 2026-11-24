/** Politica de coleta: 01/01/2024 inclusive. Referencias anteriores nao sao origens a recuperar. */
export const FIRST_YEAR=2024;
export const FIRST_MONTH='2024-01';
export const FIRST_DATE='2024-01-01';
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
export function inScopeMonth(month){return typeof month==='string'&&MONTH.test(month)&&month>=FIRST_MONTH}
export function assertScopeMonth(month){if(!inScopeMonth(month))throw Error('Competencia fora do recorte de 2024 em diante');return month}
export function inScopeDate(date){return typeof date==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(date)&&date>=FIRST_DATE}
export function inScopeNe(id){return typeof id==='string'&&/^158459\d{5}20\d{2}NE\d{6}$/.test(id)&&Number(id.slice(11,15))>=FIRST_YEAR}
export function inScopePurchaseId(id){return typeof id==='string'&&/\/(20\d{2})$/.test(id)&&Number(id.slice(-4))>=FIRST_YEAR}
export function brazilMonth(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(now);
 const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return v.year+'-'+v.month;
}
export function scopeMonths(now=new Date(),{includeCurrent=true}={}){
 const current=brazilMonth(now),out=[];
 for(let cursor=new Date(FIRST_DATE+'T00:00:00Z');;cursor.setUTCMonth(cursor.getUTCMonth()+1)){
  const month=cursor.toISOString().slice(0,7);
  if(month>current||(!includeCurrent&&month===current))break;
  out.push(month);
 }
 return out;
}
/** Uma consulta integral durante o mes corrente nao comprova cobertura do mes encerrado. */
export function closedCatalogCoverage(c){return c?.status==='complete'&&(c.skipped||0)===0&&c.closedMonth===true}
/** Completo exige evidencia por fonte/modalidade; ausencia nunca e zero. */
export function planCatalogMonth(coverage,{keys,kind,now=new Date(),slot=Math.floor(now.getTime()/86400000)}={}){
 if(!Array.isArray(keys)||!keys.length||!['source','modality'].includes(kind)||!Number.isSafeInteger(slot)||slot<0)
  throw Error('Plano de cobertura contratual invalido');
 const months=scopeMonths(now,{includeCurrent:false}),byMonth=new Map();
 for(const c of coverage||[]){
  if(!byMonth.has(c.month))byMonth.set(c.month,new Map());
  byMonth.get(c.month).set(c[kind],c);
 }
 const pending=months.map(month=>{
  const checks=byMonth.get(month)||new Map();
  return {month,missing:keys.filter(k=>!checks.has(k)),pending:keys.filter(k=>!closedCatalogCoverage(checks.get(k)))};
 }).filter(x=>x.pending.length);
 const never=pending.filter(x=>x.missing.length);
 const candidates=never.length?never:pending;
 if(!candidates.length)return null;
 const offset=slot%Math.max(1,months.length);
 const monthOrder=months.slice(offset).concat(months.slice(0,offset));
 return candidates.sort((a,b)=>monthOrder.indexOf(a.month)-monthOrder.indexOf(b.month))[0];
}

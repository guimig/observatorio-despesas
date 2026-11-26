/** Classificacao documental, nao saldo nem dotacao. SIOP e apenas referencia. */
export const BUDGET_DIMENSIONS=Object.freeze({
 action:'Ação orçamentária',program:'Programa',function:'Função',subfunction:'Subfunção',
 budgetPlan:'Plano orçamentário (PO)',locator:'Localizador',subtitle:'Subtítulo',
 economicCategory:'Categoria econômica',group:'Grupo de despesa',applicationMode:'Modalidade de aplicação',
 element:'Elemento de despesa',pi:'Plano interno (PI) confirmado · PNCP'
});
export const SIOP_DIMENSIONS=Object.freeze({...BUDGET_DIMENSIONS,
 sphere:'Esfera',fundingSource:'Fonte de recursos',primaryResult:'Resultado primário',
 useIdentifier:'Identificador de uso'});
const context=new Set(['budgetPlan','locator']);
const patterns={action:/^[A-Z0-9]{4}$/,program:/^\d{4}$/,function:/^\d{2}$/,subfunction:/^\d{3}$/,
 budgetPlan:/^[A-Z0-9]{4}$/,locator:/^\d{4}$/,subtitle:/^[A-Z0-9]{8}$/,
 economicCategory:/^\d$/,group:/^\d$/,applicationMode:/^\d{2}$/,element:/^\d{2}$/};
export function observedCode(value,kind){
 if(typeof value!=='string')return null;
 const m=/^([A-Z0-9]+)(?:\s+[-–—]\s*.*)?$/i.exec(value.trim());
 return m&&patterns[kind]?.test(m[1].toUpperCase())?m[1].toUpperCase():null;
}
function yearOf(doc){return /^20\d{2}-/.test(doc?.date||'')?doc.date.slice(0,4):null;}
function sentinel(value){
 if(typeof value!=='string'||!value.trim()||/^-\d+(?:\s|$)/.test(value.trim())&&!/m[úu]ltipl/i.test(value))return 'missing';
 if(/(?:^|\s|-\s*)m[úu]ltipl[oa](?:\s|$)/i.test(value))return 'multiple';
 return null;
}
const missing=()=>({key:'missing',label:'Não recuperado / não informado',kind:'missing'});
const multiple=()=>({key:'multiple',label:'Múltiplas classificações (sem rateio)',kind:'multiple'});
export function budgetBucket(doc,dimension,{confirmedPi=[]}={}){
 if(!Object.hasOwn(BUDGET_DIMENSIONS,dimension))return missing();
 const year=yearOf(doc);if(!year)return missing();
 if(dimension==='pi'){
  if(doc.phase!==1)return missing();
  const pi=[...new Set(confirmedPi.filter(v=>typeof v==='string'&&v.trim()))].sort();
  if(!pi.length)return missing();if(pi.length>1)return multiple();
  return {key:JSON.stringify([year,'pi',pi[0]]),label:year+' · '+pi[0],kind:'observed',year,code:pi[0]};
 }
 const raw=doc.nature?.[dimension],status=sentinel(raw);
 if(status==='missing')return missing();if(status==='multiple')return multiple();
 const code=observedCode(raw,dimension);
 const action=context.has(dimension)?observedCode(doc.nature?.action,'action'):null;
 if(context.has(dimension)&&!action)return {key:'context_missing',label:'PO/localizador sem ação inequívoca',kind:'missing'};
 const key=JSON.stringify([year,dimension,action,code||raw]);
 return {key,label:year+' · '+(action?action+' / ':'')+raw,kind:'observed',year,code,action};
}
export function referenceFor(catalog,bucket,dimension){
 if(bucket?.kind!=='observed'||!bucket.code||dimension==='pi'||dimension==='subtitle')return null;
 const dictionary=catalog?.dictionaries?.find(d=>String(d.year)===bucket.year);
 const rows=dictionary?.rows?.filter(r=>r.kind===dimension&&r.code===bucket.code&&
  (!context.has(dimension)||r.action===bucket.action))||[];
 return rows.length===1?rows[0].label:null;
}
export function summarizeBudget(entries,dimension,{confirmedPi=()=>[]}={}){
 const groups=new Map();
 for(const entry of entries||[]){
  const doc=entry.doc,bucket=budgetBucket(doc,dimension,{confirmedPi:confirmedPi(doc)});
  let g=groups.get(bucket.key);
  if(!g){g={...bucket,count:0,phase:Object.fromEntries([1,2,3].map(p=>[p,{count:0,known:0,unknown:0,cents:0}]))};groups.set(bucket.key,g);}
  g.count++;
  const phase=g.phase[doc.phase];if(!phase)continue;
  phase.count++;
  if(Number.isSafeInteger(doc.cents)&&Number.isSafeInteger(phase.cents+doc.cents)){phase.known++;phase.cents+=doc.cents;}
  else phase.unknown++;
 }
 return [...groups.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'pt-BR'));
}

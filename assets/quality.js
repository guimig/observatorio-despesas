/** Auditoria descritiva da cobertura CGU. Não concilia saldos contábeis. */
const PHASES=[1,2,3];
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const NE=/^158459\d{5}20\d{2}NE\d{6}$/;

export function closedDaysInMonth(month,now=new Date()){
  if(!MONTH.test(month)||!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw Error('Competência ou data inválida');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).map(p=>[p.type,p.value]));
  const today=parts.year+'-'+parts.month;
  const last=new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),0)).getUTCDate();
  return month<today?last:month>today?0:Math.min(last,Math.max(0,+parts.day-1));
}

/** Cobertura diária, enriquecimento e qualidade estrutural: métricas independentes. */
export function auditMonth(month,{now=new Date()}={}){
  if(!month||!MONTH.test(month.month)||!Array.isArray(month.documents)||
     !Array.isArray(month.coverage)||!Array.isArray(month.relations))
    throw Error('Dados mensais incompatíveis com auditoria');
  const expectedDays=closedDaysInMonth(month.month,now);
  const days=new Map(),docs=new Map(),issues=[];
  for(const c of month.coverage){
    if(!days.has(c.date))days.set(c.date,new Map());
    const byPhase=days.get(c.date);
    if(byPhase.has(c.phase))issues.push('cobertura_duplicada');
    byPhase.set(c.phase,c);
  }
  for(const doc of month.documents){
    if(docs.has(doc.id))issues.push('documento_duplicado');
    docs.set(doc.id,doc);
    if(!days.get(doc.date)?.has(doc.phase))issues.push('documento_sem_cobertura');
  }
  let completeDays=0,partialDays=0,missingDays=0,partialQueries=0,invalidValues=0;
  for(let day=1;day<=expectedDays;day++){
    const date=month.month+'-'+String(day).padStart(2,'0');
    const statuses=days.get(date);
    if(!statuses?.size){missingDays++;continue;}
    if(PHASES.every(phase=>statuses.get(phase)?.complete===true &&
       statuses.get(phase)?.invalid===0)){completeDays++;continue;}
    partialDays++;
  }
  for(const c of month.coverage){
    if(c.complete!==true)partialQueries++;
    invalidValues+=Number(c.invalid)||0;
    const matches=month.documents.filter(d=>d.date===c.date&&d.phase===c.phase);
    if(matches.length!==c.count ||
       matches.filter(d=>d.cents===null).length!==c.invalid)
      issues.push('contagem_divergente');
  }
  const byPhase=phase=>{
    const set=month.documents.filter(doc=>doc.phase===phase);
    const checked=set.filter(doc=>phase===2?doc.liquidationLinksChecked===true:
      phase===3?doc.paymentLinksChecked===true:
      Object.hasOwn(month.itemsByDocument||{},doc.id)).length;
    return {total:set.length,checked,pending:set.length-checked};
  };
  const pairs=new Set(),bySource=new Map();
  let negative=0,crossExercise=0;
  for(const relation of month.relations){
    const pair=relation.from+'/'+relation.to,source=docs.get(relation.from);
    if(pairs.has(pair))issues.push('vinculo_duplicado');
    pairs.add(pair);
    if(!source||![2,3].includes(source.phase)||!NE.test(relation.to)||
       !Number.isSafeInteger(relation.cents))
      issues.push('vinculo_invalido');
    if(!bySource.has(relation.from))bySource.set(relation.from,new Set());
    bySource.get(relation.from).add(relation.to);
    if(relation.cents<0)negative++;
    if(source&&relation.to.slice(11,15)!==source.id.slice(11,15))crossExercise++;
  }
  // Divergências de soma são apenas alertas para revisão: o valor do documento
  // não deve ser substituído por impactos nem por pagamentos de restos a pagar.
  const valuesBySource=new Map();
  for(const relation of month.relations){
    const values=valuesBySource.get(relation.from)||[];
    values.push(relation.cents);
    valuesBySource.set(relation.from,values);
  }
  let liquidationValueReviews=0;
  for(const doc of month.documents.filter(d=>d.phase===2&&d.liquidationLinksChecked===true)){
    const values=valuesBySource.get(doc.id);
    if(!values?.length||!Number.isSafeInteger(doc.cents))continue;
    const sum=values.reduce((acc,value)=>acc+value,0);
    if(!Number.isSafeInteger(sum)||sum!==doc.cents)liquidationValueReviews++;
  }
  const liquidations=byPhase(2),payments=byPhase(3),items=byPhase(1);
  return {
    month:month.month,
    coverage:{
      expectedDays,completeDays,partialDays,missingDays,partialQueries,invalidValues,
      status:expectedDays===0?'sem_dias_encerrados':
        completeDays===expectedDays?'completa':'parcial'
    },
    enrichment:{liquidations,payments,items,
      pending:liquidations.pending+payments.pending+items.pending},
    links:{total:month.relations.length,
      multipleCommitments:[...bySource.values()].filter(set=>set.size>1).length,
      negative,crossExercise,liquidationValueReviews},
    issues:[...new Set(issues)].sort()
  };
}

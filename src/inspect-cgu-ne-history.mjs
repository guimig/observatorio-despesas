/**
 * Diagnostico autenticado e efemero das operacoes de itens de NEs antigas.
 * Usa somente IDs SIAFI ja presentes no acervo; nenhum ID, texto livre,
 * valor, fornecedor, payload ou token sai para log/JSON do projeto.
 */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveItems} from './enrich-cgu.mjs';
import {resolveItemMovements} from './item-movements.mjs';

const NE=/^158459\d{5}(20\d{2})NE\d{6}$/;
const EXPENDITURE=/^158459\d{5}(20\d{2})(NS|OB|DF)\d{6}$/;
const TYPES=['original','reinforcement','annulment','cancellation','reversal','other','unknown'];
const COHORTS=['cross_year_payment','cross_year_liquidation','older_origin','current_control'];
const COHORT_QUOTAS={cross_year_payment:5,cross_year_liquidation:3,
 older_origin:4,current_control:2};
const YEARS=['previous','same','later','invalid'];
const emptyYearCounts=()=>Object.fromEntries(YEARS.map(x=>[x,0]));
function eventYearGroup(date,year){
 const match=typeof date==='string'&&/^(20\d{2})-\d{2}-\d{2}$/.exec(date);
 if(!match)return 'invalid';
 const eventYear=Number(match[1]);
 return eventYear<year?'previous':eventYear===year?'same':'later';
}
const FAILURES=new Set(['consulta_indisponivel','resposta_invalida','pagina_repetida',
 'limite_paginacao','item_invalido','movimentacao_invalida',
 'sequencial_duplicado_divergente','impacto_nao_identificado','acesso_negado',
 'recurso_nao_encontrado','erro_http']);
const emptyCounts=()=>Object.fromEntries(TYPES.map(x=>[x,0]));
const safeReason=reason=>FAILURES.has(reason)?reason:'other_failure';
const yearOf=id=>Number(NE.exec(id)?.[1]||0);

/** Vinculos em fases posteriores sao criterios amostrais, nao prova de RP. */
export function planHistoricalNeProbes(months,{max=14,window=0}={}){
 if(!Array.isArray(months)||!Number.isSafeInteger(max)||max<1||max>20||
    !Number.isSafeInteger(window)||window<0)
   throw Error('Amostragem historica invalida');
 const originals=new Map(),payment=new Set(),liquidation=new Set();
 for(const source of months){
   if(!/^\d{4}-\d{2}$/.test(source?.month)||
      !Array.isArray(source?.data?.documents)||
      !Array.isArray(source?.data?.relations))
     throw Error('Competencia historica invalida');
   const docs=new Map(source.data.documents.map(x=>[x?.id,x]));
   for(const doc of source.data.documents){
     const match=NE.exec(doc?.id||'');
     if(match&&doc.phase===1)originals.set(doc.id,Number(match[1]));
   }
   for(const link of source.data.relations){
     const match=NE.exec(link?.to||'');
     const from=EXPENDITURE.exec(link?.from||'');
     if(!match||!from||Number(from[1])<=Number(match[1]))continue;
     const doc=docs.get(link.from);
     if(doc?.phase===(from[2]==='NS'?2:3)){
       if(doc.phase===3)payment.add(link.to);
       else liquidation.add(link.to);
     }
   }
 }
 const referenceYear=months.length?Math.max(...months.map(x=>Number(x.month.slice(0,4)))):0;
 const pools={
   cross_year_payment:[...payment].filter(x=>NE.test(x)).sort(),
   cross_year_liquidation:[...liquidation].filter(x=>NE.test(x)).sort(),
   older_origin:[...originals].filter(([,y])=>y<referenceYear).map(([id])=>id).sort(),
   current_control:[...originals].filter(([,y])=>y===referenceYear).map(([id])=>id).sort()
 };
 // Rotacao deterministica por execucao: uma reexecucao consulta outra faixa,
 // sem aumentar o numero de chamadas nem registrar identificadores.
 for(const cohort of COHORTS){
   const pool=pools[cohort];
   if(!pool.length)continue;
   const shift=((window%pool.length)*COHORT_QUOTAS[cohort])%pool.length;
   pools[cohort]=pool.slice(shift).concat(pool.slice(0,shift));
 }
 const chosen=[],seen=new Set();
 const cycle=['cross_year_payment','cross_year_liquidation','older_origin',
   'cross_year_payment','older_origin','current_control'];
 while(chosen.length<max){
   let added=0;
   for(const cohort of cycle){
     if(chosen.length===max)break;
     while(pools[cohort].length&&seen.has(pools[cohort][0]))pools[cohort].shift();
     const id=pools[cohort].shift();
     if(!id)continue;
     seen.add(id);
     chosen.push({id,cohort,year:yearOf(id)});
     added++;
   }
   if(!added)break;
 }
 return chosen;
}

/** Prioriza itens com valor atual nulo, e combina inicio/fim da lista. */
export function pickHistoricalItems(items,{max=3}={}){
 if(!Array.isArray(items)||!Number.isSafeInteger(max)||max<1||max>5)
   throw Error('Selecao de itens invalida');
 const bySeq=new Map();
 for(const item of items){
   if(!Number.isSafeInteger(item?.seq)||item.seq<1)
     throw Error('Sequencial historico invalido');
   if(bySeq.has(item.seq))throw Error('Sequencial historico repetido');
   bySeq.set(item.seq,item);
 }
 const sorted=[...bySeq.values()].sort((a,b)=>a.seq-b.seq);
 const selected=[],seen=new Set();
 function add(item){if(item&&!seen.has(item.seq)&&selected.length<max){
   seen.add(item.seq);selected.push(item);
 }}
 for(const item of sorted.filter(x=>x.cents===0))add(item);
 add(sorted[0]);add(sorted.at(-1));
 for(const item of sorted)add(item);
 return selected;
}
function emptyAudit(cohort){
 return {cohort,status:'complete',itemsAvailable:0,itemsSampled:0,
   itemsNotSampled:0,historiesCompleted:0,
   historiesUnavailable:0,movements:emptyCounts(),
   cancellationDates:emptyYearCounts(),otherDates:emptyYearCounts(),
   cancellationItems:0,reasonCounts:{}};
}
function addReason(result,reason){
 const code=safeReason(reason);
 result.reasonCounts[code]=(result.reasonCounts[code]||0)+1;
}
export async function auditHistoricalNe(sample,{
 token,resolveItemsFn=resolveItems,resolveHistoryFn=resolveItemMovements,
 maxItems=3
}={}){
 if(!sample||!NE.test(sample.id)||!COHORTS.includes(sample.cohort)||
    sample.year!==yearOf(sample.id))throw Error('Amostra de NE invalida');
 if(!token||typeof token!=='string')throw Error('CGU_API_KEY ausente');
 const result=emptyAudit(sample.cohort);
 let items;
 try{items=await resolveItemsFn(sample.id,{token,limit:3});}
 catch{items={ok:false,reason:'consulta_indisponivel'};}
 if(!items?.ok||!Array.isArray(items.items)){
   result.status='items_unavailable';
   addReason(result,items?.reason);
   return result;
 }
 result.itemsAvailable=items.items.length;
 if(!items.items.length){result.status='no_items';return result;}
 let chosen;
 try{chosen=pickHistoricalItems(items.items,{max:maxItems});}
 catch{result.status='items_invalid';return result;}
 result.itemsSampled=chosen.length;
 result.itemsNotSampled=items.items.length-chosen.length;
 for(const item of chosen){
   let outcome;
   try{outcome=await resolveHistoryFn(sample.id,item.seq,{token,limit:4});}
   catch{outcome={ok:false,reason:'consulta_indisponivel'};}
   if(!outcome?.ok||!Array.isArray(outcome.movements)){
     result.historiesUnavailable++;
     addReason(result,outcome?.reason);
     continue;
   }
   result.historiesCompleted++;
   if(!outcome.movements.length)continue;
   let cancellationSeen=false;
   for(const event of outcome.movements){
     const type=TYPES.includes(event?.type)?event.type:'unknown';
     result.movements[type]++;
     if(type==='other')result.otherDates[eventYearGroup(event.date,sample.year)]++;
     if(type!=='cancellation')continue;
     cancellationSeen=true;
     result.cancellationDates[eventYearGroup(event.date,sample.year)]++;
   }
   if(cancellationSeen)result.cancellationItems++;
 }
 if(result.historiesUnavailable)result.status='partial';
 else if(!result.historiesCompleted)result.status='no_history';
 else if(result.itemsNotSampled)result.status='sampled_only';
 return result;
}
export function summarizeNeAudits(audits){
 if(!Array.isArray(audits))throw Error('Diagnostico invalido');
 const output={sampled:audits.length,cohorts:{}};
 for(const cohort of COHORTS){
   output.cohorts[cohort]={notes:0,status:{},itemsAvailable:0,
     itemsSampled:0,itemsNotSampled:0,
     historiesCompleted:0,historiesUnavailable:0,movements:emptyCounts(),
     cancellationDates:emptyYearCounts(),otherDates:emptyYearCounts(),
     cancellationItems:0,reasons:{}};
 }
 for(const row of audits){
   if(!COHORTS.includes(row?.cohort))throw Error('Categoria de NE invalida');
   const bucket=output.cohorts[row.cohort];
   bucket.notes++;
   bucket.status[row.status]=(bucket.status[row.status]||0)+1;
   for(const k of ['itemsAvailable','itemsSampled','itemsNotSampled',
     'historiesCompleted','historiesUnavailable','cancellationItems'])
     bucket[k]+=row[k];
   for(const kind of TYPES)bucket.movements[kind]+=row.movements[kind];
   for(const k of YEARS){
     bucket.cancellationDates[k]+=row.cancellationDates[k];
     bucket.otherDates[k]+=row.otherDates[k];
   }
   for(const [key,value] of Object.entries(row.reasonCounts)){
     const label=safeReason(key);
     bucket.reasons[label]=(bucket.reasons[label]||0)+value;
   }
 }
 return output;
}
async function main(){
 const token=process.env.CGU_API_KEY;
 if(!token)throw Error('CGU_API_KEY ausente');
 const root=process.cwd();
 const manifest=JSON.parse(await readFile(join(root,'data/manifest.json'),'utf8'));
 const months=await Promise.all([...manifest.months].sort().reverse()
   .map(async month=>({month,data:JSON.parse(await readFile(
      join(root,'data/months',month+'.json'),'utf8'))})));
 // GITHUB_RUN_NUMBER se mantem em rerun e avanca na execucao seguinte.
 const window=Number(process.env.GITHUB_RUN_NUMBER||0);
 const plan=planHistoricalNeProbes(months,{max:14,window});
 const audits=[];
 for(const [index,item] of plan.entries()){
   if(index)await new Promise(done=>setTimeout(done,700));
   audits.push(await auditHistoricalNe(item,{token,maxItems:3}));
 }
 const summary=summarizeNeAudits(audits);
 console.log('Janela de amostragem de NE (sem IDs): '+window);
 console.log('Diagnostico historico de NE CGU: '+JSON.stringify(summary));
 console.log('Amostras nao representam universo das NEs. '+
   'Historico completo de itens amostrados nao prova conferencia da NE inteira. '+
   'Operacoes "other" exigem validacao da semantica na fonte. '+
   'Cancelamento por item nao prova saldo de RP nem abrange outros registros contabeis. '+
   'Nenhum documento, valor, texto livre, CPF ou token registrado.');
 const consulted=audits.filter(x=>x.historiesCompleted>0).length;
 if(plan.length&&!consulted)throw Error('Nenhum historico de item confirmado pela fonte');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 main().catch(error=>{
   console.error(/CGU_API_KEY/.test(error.message)?
     'Secret CGU_API_KEY ausente':'Sondagem historica nao concluida; acervo intacto.');
   process.exitCode=1;
 });
}

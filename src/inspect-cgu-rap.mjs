/**
 * Auditoria amostral e temporaria de evidencias de restos a pagar na API CGU.
 * Nao grava valores, respostas brutas, identificadores, CPF ou saldos.
 * Vinculo com NE de exercicio anterior e apenas criterio de amostragem.
 */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getCguArray,parseMoneyCents} from './cgu.mjs';
import {impactUrl,docType} from './inspect-cgu-siafi.mjs';

const DOCUMENT=/^158459\d{5}(20\d{2})(NS|OB|DF)\d{6}$/;
const COMMITMENT=/^158459\d{5}(20\d{2})NE\d{6}$/;
export const IMPACT_FIELDS=Object.freeze([
 'valorLiquidado','valorPago','valorRestoInscrito','valorRestoCancelado','valorRestoPago'
]);
const kinds={NS:2,OB:3,DF:3};
const YEARS=['prior','same','future','unknown'];
const emptyCohorts=()=>Object.fromEntries(YEARS.map(year=>
 [year,{rows:0,fields:emptyStats()}]));
function addFieldCounts(target,source){
 for(const key of IMPACT_FIELDS){
   for(const category of Object.keys(target[key]))
     target[key][category]+=source[key][category];
 }
}

/** Exige codigo completo do empenho, nao deduz o exercicio pelo nome reduzido. */
export function impactCommitmentYearGroup(row,documentYear){
 const raw=typeof row?.empenho==='string'?row.empenho:
   typeof row?.empenho?.documento==='string'?row.empenho.documento:'';
 const match=COMMITMENT.exec(raw);
 if(!match||!Number.isInteger(documentYear)||documentYear<2000||documentYear>2099)
   return 'unknown';
 const year=Number(match[1]);
 return year<documentYear?'prior':year>documentYear?'future':'same';
}
const emptyStats=()=>Object.fromEntries(IMPACT_FIELDS.map(k=>
 [k,{missing:0,invalid:0,negative:0,zero:0,positive:0}]));

function fieldCategory(value){
 if(value===null||value===undefined||value==='')return 'missing';
 const cents=parseMoneyCents(value);
 if(cents===null)return 'invalid';
 return cents===0?'zero':cents<0?'negative':'positive';
}

/** Apenas cobertura por campo/sinal. Nao agrega valores nem classifica a natureza contábil. */
export function summarizeImpactFields(rows,{documentYear=null}={}){
 if(!Array.isArray(rows))throw Error('Amostra de impactos invalida');
 const fields=emptyStats(),byCommitmentYear=emptyCohorts();
 for(const row of rows){
   if(!row||typeof row!=='object'||Array.isArray(row))
     throw Error('Linha de impacto invalida');
   const group=byCommitmentYear[impactCommitmentYearGroup(row,documentYear)];
   group.rows++;
   for(const key of IMPACT_FIELDS){
     const category=fieldCategory(row[key]);
     fields[key][category]++;
     group.fields[key][category]++;
   }
 }
 return {rows:rows.length,fields,byCommitmentYear};
}

/** Estratifica documentos sem duplicar ID entre competencias e sem assumir que sejam RP. */
export function selectRapSamples(months,{max=4}={}){
 if(!Array.isArray(months)||!Number.isSafeInteger(max)||max<1||max>24)
   throw Error('Amostragem invalida');
 const records=[];
 for(const source of months){
   const month=source?.month,data=source?.data;
   if(!/^\d{4}-\d{2}$/.test(month)||!Array.isArray(data?.documents)||
      !Array.isArray(data?.relations))throw Error('Competencia documental invalida');
   const docs=new Map(data.documents.filter(d=>DOCUMENT.test(d?.id) &&
     d.phase===kinds[docType(d.id)]).map(d=>[d.id,d]));
   const links=new Map();
   for(const edge of data.relations){
     if(!docs.has(edge?.from))continue;
     const ne=COMMITMENT.exec(String(edge.to||''));
     if(!ne)continue;
     const doc=DOCUMENT.exec(edge.from);
     if(!doc)continue;
     const group=links.get(edge.from)||{previous:0,current:0};
     if(Number(ne[1])<Number(doc[1]))group.previous++;
     else if(ne[1]===doc[1])group.current++;
     links.set(edge.from,group);
   }
   for(const [id,link] of links){
     records.push({id,month,kind:docType(id),phase:kinds[docType(id)],
       priorYearReference:link.previous>0,sameYearReference:link.current>0});
   }
 }
 records.sort((a,b)=>b.month.localeCompare(a.month)||a.id.localeCompare(b.id));
 const seen=new Set();
 const groups=Object.fromEntries(['NS','OB','DF'].flatMap(kind=>
   [kind+'_prior',kind+'_current'].map(key=>[key,[]])));
 for(const record of records){
   if(seen.has(record.id))continue;
   seen.add(record.id);
   groups[record.kind+'_'+(record.priorYearReference?'prior':'current')].push(record);
 }
 // Duas vagas de vinculo interanual para cada vaga de controle contemporaneo.
 // A rodada inclui NS, OB e DF, preservando diversidade e volume moderado.
 const schedule=['NS_prior','OB_prior','DF_prior',
   'NS_prior','OB_prior','DF_prior','NS_current','OB_current','DF_current'];
 const selected=[];
 while(selected.length<max){
   let additions=0;
   for(const name of schedule){
     if(selected.length>=max)break;
     const next=groups[name].shift();
     if(next){selected.push(next);additions++;}
   }
   if(!additions)break;
 }
 return selected;
}

function failureCategory(error){
 const status=Number(error?.status);
 return Number.isInteger(status)&&status>=400&&status<=599?
   'http_'+status:'source_unavailable';
}
function result(status,reason,pages,rows,fields,complete,byCommitmentYear){
 return {status,reason,pages,rows,complete,fields,byCommitmentYear};
}

/** So informa amostra completa apos encontrar pagina terminal vazia.
 * Falha HTTP, pagina repetida, limite ou linha inesperada nunca vira zero.
 */
export async function inspectRapImpacts(id,phase,{
 token,request=getCguArray,maxPages=4
}={}){
 if(!DOCUMENT.test(id)||kinds[docType(id)]!==phase||
    !Number.isSafeInteger(maxPages)||maxPages<1||maxPages>8)
   throw Error('Documento/fase para auditoria invalido');
 if(!token||typeof token!=='string')throw Error('CGU_API_KEY ausente');
 const fields=emptyStats(),byCommitmentYear=emptyCohorts(),seen=new Set();
 const documentYear=Number(DOCUMENT.exec(id)[1]);
 let rows=0,pages=0;
 for(let page=1;page<=maxPages;page++){
   let response;
   try{response=await request(impactUrl(id,phase,page),{token});}
   catch(error){
     return result('unavailable',failureCategory(error),pages,rows,fields,false,byCommitmentYear);
   }
   if(!Array.isArray(response))
     return result('unavailable','invalid_response',pages,rows,fields,false,byCommitmentYear);
   if(!response.length)
     return result(rows?'complete':'empty',rows?'terminal_page':'no_rows',
       pages,rows,fields,true,byCommitmentYear);
   // A impressao digital fica apenas na memoria do processo, nunca no log.
   const fingerprint=JSON.stringify(response);
   if(seen.has(fingerprint))
     return result('unavailable','repeated_page',pages,rows,fields,false,byCommitmentYear);
   seen.add(fingerprint);
   let summary;
   try{summary=summarizeImpactFields(response,{documentYear});}
   catch{
     return result('unavailable','invalid_row',pages,rows,fields,false,byCommitmentYear);
   }
   pages++;rows+=summary.rows;
   addFieldCounts(fields,summary.fields);
   for(const year of YEARS){
     byCommitmentYear[year].rows+=summary.byCommitmentYear[year].rows;
     addFieldCounts(byCommitmentYear[year].fields,summary.byCommitmentYear[year].fields);
   }
 }
 return result('partial','page_limit',pages,rows,fields,false,byCommitmentYear);
}

export async function auditRapSample(sample,options={}){
 if(!sample||!DOCUMENT.test(sample.id)||kinds[sample.kind]!==sample.phase||
    docType(sample.id)!==sample.kind||
    typeof sample.priorYearReference!=='boolean'||
    typeof sample.sameYearReference!=='boolean')
   throw Error('Perfil de amostra invalido');
 const impacts=await inspectRapImpacts(sample.id,sample.phase,options);
 return {kind:sample.kind,phase:sample.phase,
   priorYearReference:sample.priorYearReference,
   sameYearReference:sample.sameYearReference,impacts};
}

async function main(){
 const token=process.env.CGU_API_KEY;
 if(!token)throw Error('CGU_API_KEY ausente');
 const root=process.cwd();
 const manifest=JSON.parse(await readFile(join(root,'data/manifest.json'),'utf8'));
 const months=await Promise.all([...manifest.months].sort().reverse().slice(0,6)
   .map(async month=>({month,data:JSON.parse(await readFile(
     join(root,'data/months',month+'.json'),'utf8'))})));
 const samples=selectRapSamples(months,{max:18});
 console.log('Sondagem de campos de RP CGU: '+samples.length+
   ' documentos da UG 158459. Vinculo com NE anterior NAO prova inscricao em RP.');
 for(const [index,sample] of samples.entries()){
   if(index)await new Promise(resolve=>setTimeout(resolve,650));
   const audit=await auditRapSample(sample,{token,maxPages:4});
   console.log('Perfil CGU: '+JSON.stringify(audit));
 }
 console.log('Somente cobertura de campos e sinais. Sem valores, IDs, CPF, '+
   'dados brutos ou calculo de RP processado/nao processado/saldo.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 main().catch(error=>{
   console.error(/CGU_API_KEY/.test(error.message)?
     'Secret CGU_API_KEY ausente':'Sondagem de RP nao concluida; sem modificacao de dados.');
   process.exitCode=1;
 });
}

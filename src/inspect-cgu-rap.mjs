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
const emptyStats=()=>Object.fromEntries(IMPACT_FIELDS.map(k=>
 [k,{missing:0,invalid:0,negative:0,zero:0,positive:0}]));

function fieldCategory(value){
 if(value===null||value===undefined||value==='')return 'missing';
 const cents=parseMoneyCents(value);
 if(cents===null)return 'invalid';
 return cents===0?'zero':cents<0?'negative':'positive';
}

/** Apenas cobertura por campo/sinal. Nao agrega valores nem classifica a natureza contábil. */
export function summarizeImpactFields(rows){
 if(!Array.isArray(rows))throw Error('Amostra de impactos invalida');
 const fields=emptyStats();
 for(const row of rows){
   if(!row||typeof row!=='object'||Array.isArray(row))
     throw Error('Linha de impacto invalida');
   for(const key of IMPACT_FIELDS)fields[key][fieldCategory(row[key])]++;
 }
 return {rows:rows.length,fields};
}

/** Seleciona ate quatro perfis por vinculos documentais ja publicados, sem supor RP. */
export function selectRapSamples(months,{max=4}={}){
 if(!Array.isArray(months)||!Number.isSafeInteger(max)||max<1||max>8)
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
 records.sort((a,b)=>b.month.localeCompare(a.month)||
   a.id.localeCompare(b.id));
 const groups=[
   x=>x.priorYearReference&&x.kind==='NS',
   x=>x.priorYearReference&&x.kind!=='NS',
   x=>!x.priorYearReference&&x.kind==='NS',
   x=>!x.priorYearReference&&x.kind!=='NS'
 ];
 const chosen=[];
 for(const match of groups){
   const record=records.find(x=>match(x)&&!chosen.includes(x));
   if(record)chosen.push(record);
   if(chosen.length>=max)return chosen;
 }
 for(const record of records){
   if(chosen.length>=max)break;
   if(!chosen.includes(record))chosen.push(record);
 }
 return chosen;
}

function failureCategory(error){
 const status=Number(error?.status);
 return Number.isInteger(status)&&status>=400&&status<=599?
   'http_'+status:'source_unavailable';
}
function result(status,reason,pages,rows,fields,complete){
 return {status,reason,pages,rows,complete,fields};
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
 const fields=emptyStats(),seen=new Set();
 let rows=0,pages=0;
 for(let page=1;page<=maxPages;page++){
   let response;
   try{response=await request(impactUrl(id,phase,page),{token});}
   catch(error){
     return result('unavailable',failureCategory(error),pages,rows,fields,false);
   }
   if(!Array.isArray(response))
     return result('unavailable','invalid_response',pages,rows,fields,false);
   if(!response.length)
     return result(rows?'complete':'empty',rows?'terminal_page':'no_rows',
       pages,rows,fields,true);
   // A impressao digital fica apenas na memoria do processo, nunca no log.
   const fingerprint=JSON.stringify(response);
   if(seen.has(fingerprint))
     return result('unavailable','repeated_page',pages,rows,fields,false);
   seen.add(fingerprint);
   let summary;
   try{summary=summarizeImpactFields(response);}
   catch{
     return result('unavailable','invalid_row',pages,rows,fields,false);
   }
   pages++;rows+=summary.rows;
   for(const key of IMPACT_FIELDS){
     for(const category of Object.keys(fields[key])){
       fields[key][category]+=summary.fields[key][category];
     }
   }
 }
 return result('partial','page_limit',pages,rows,fields,false);
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
 const samples=selectRapSamples(months);
 console.log('Sondagem de campos de RP CGU: '+samples.length+
   ' documentos da UG 158459. Vinculo com NE anterior NAO prova inscricao em RP.');
 for(const sample of samples){
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
